import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentSubmissionRepository } from './submissions.repository';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from './milestone-document-flow.integration-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const fixture = new MilestoneDocumentFlowFixture();

beforeAll(() => fixture.start());
beforeEach(async () => {
  await fixture.reset();
  await fixture.prisma.milestone.update({
    where: { id: flowIds.milestone },
    data: { submissionType: 'TEXT' },
  });
  await fixture.prisma.milestoneDocument.update({
    where: { id: flowIds.document },
    data: { kind: 'LEGACY_MILESTONE_SUBMISSION' },
  });
});
afterAll(() => fixture.stop());

it('holds the same submission row lock used by the old review API before reading the item review version', async () => {
  expect((await fixture.submit('initial content')).status).toBe(201);
  const repository = new MilestoneDocumentsRepository(
    fixture.prisma,
    new LockProgramTreeRepository(),
    new PlatformRepository(),
    new MilestoneDocumentSubmissionRepository(new PlatformRepository()),
    new MilestoneDocumentCollectionReadRepository(fixture.prisma),
  );
  const contender = new PrismaService();
  try {
    await repository.withTransaction(async (store) => {
      await store.lockDocument(flowIds.document);
      await store.findSubmissionForReview(
        flowIds.document,
        flowIds.application,
      );
      await expect(contender.$queryRaw`
        SELECT "id" FROM "MilestoneDocumentSubmission"
        WHERE "milestoneDocumentId" = ${flowIds.document}
          AND "applicationId" = ${flowIds.application}
        FOR UPDATE NOWAIT
      `).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    });
  } finally {
    await contender.$disconnect();
  }
});

it('keeps the old document list stable and exposes legacy items only to the opt-in client', async () => {
  const previous = await fixture.request(
    `milestones/${flowIds.milestone}/documents`,
  );
  expect(previous.status).toBe(200);
  expect(await previous.json()).toMatchObject({ documents: [] });

  const next = await fixture.request(
    `milestones/${flowIds.milestone}/documents?scope=all`,
  );

  expect(next.status).toBe(200);
  expect(await next.json()).toMatchObject({
    documents: [expect.objectContaining({ id: flowIds.document })],
  });
});

it('reads and replaces an old-client submission through the requirement API without creating a second submission', async () => {
  const previous = await fixture.request('submissions', {
    method: 'POST',
    json: {
      applicationId: flowIds.application,
      milestoneId: flowIds.milestone,
      content: { type: 'TEXT', text: 'old client content' },
      comment: 'original comment',
    },
  });
  expect(previous.status).toBe(201);

  const next = await fixture.submit('requirement client content');

  expect(next.status).toBe(201);
  const submissions = await fixture.prisma.milestoneDocumentSubmission.findMany(
    {
      where: { milestoneDocumentId: flowIds.document },
      select: { id: true, revision: true, content: true },
    },
  );
  expect(
    submissions.map(({ revision, content }) => ({ revision, content })),
  ).toEqual([
    {
      revision: 2,
      content: { type: 'TEXT', text: 'requirement client content' },
    },
  ]);
  const submission = submissions[0];
  if (submission === undefined) throw new Error('Expected one submission');
  expect(await previous.json()).toMatchObject({ submissionId: submission.id });
  const context = await fixture.request(
    `submissions/${submission.id}/review-context`,
    {
      actor: 'staff',
    },
  );
  expect(context.status).toBe(200);
  expect(await context.json()).toMatchObject({
    submissionId: submission.id,
    currentRevision: { number: 2 },
    history: [expect.objectContaining({ number: 1 })],
  });
});

it('rejects a stale requirement review after the old review API has decided the same revision', async () => {
  expect((await fixture.submit('requirement client content')).status).toBe(201);
  const submission =
    await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
      where: { milestoneDocumentId: flowIds.document },
      select: { id: true },
    });
  const previous = await fixture.request(
    `submissions/${submission.id}/reviews`,
    {
      actor: 'staff',
      method: 'POST',
      json: { revision: 1, decision: 'APPROVED' },
    },
  );
  expect(previous.status).toBe(201);

  const next = await fixture.request(
    `${fixture.documentPath()}/applications/${flowIds.application}/reviews`,
    {
      actor: 'staff',
      method: 'POST',
      json: {
        decision: 'REJECTED',
        comment: 'stale decision',
        expectedRevision: 1,
        expectedLatestReviewId: null,
      },
    },
  );

  expect(next.status).toBe(409);
  expect(
    await fixture.prisma.milestoneDocumentSubmissionHistory.count({
      where: {
        milestoneDocumentSubmissionId: submission.id,
        event: 'APPROVED',
      },
    }),
  ).toBe(1);
  expect(
    await fixture.prisma.milestoneDocumentSubmissionHistory.count({
      where: {
        milestoneDocumentSubmissionId: submission.id,
        event: 'REJECTED',
      },
    }),
  ).toBe(0);
});

it('preserves the observed revision and optional comment when two requirement clients replace the same submission', async () => {
  const submit = (text: string, expectedRevision: number) =>
    fixture.request(fixture.documentPath() + '/submissions', {
      method: 'POST',
      json: {
        content: { text },
        expectedRevision,
        comment: '  retained note  ',
      },
    });
  expect((await submit('initial', 0)).status).toBe(201);
  const responses = await Promise.all([
    submit('replacement A', 1),
    submit('replacement B', 1),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    201, 409,
  ]);
  const stale = responses.find((response) => response.status === 409);
  expect(await stale?.json()).toMatchObject({ code: 'MSD_048' });
  const submission =
    await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
      where: { milestoneDocumentId: flowIds.document },
      select: {
        revision: true,
        histories: {
          orderBy: { createdAt: 'asc' },
          select: { revision: true, comment: true },
        },
      },
    });
  expect(submission).toEqual({
    revision: 2,
    histories: [
      { revision: 1, comment: 'retained note' },
      { revision: 2, comment: 'retained note' },
    ],
  });
});

it('accepts an explicitly empty optional comment from a requirement client', async () => {
  const response = await fixture.request(
    fixture.documentPath() + '/submissions',
    {
      method: 'POST',
      json: {
        content: { text: 'content without comment' },
        comment: null,
        expectedRevision: 0,
      },
    },
  );
  expect(response.status).toBe(201);
  const history =
    await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
      where: {
        submission: { milestoneDocumentId: flowIds.document },
        event: 'SUBMITTED',
      },
      select: { comment: true },
    });
  expect(history.comment).toBeNull();
});

it.each(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const)(
  'keeps a new %s decision readable by the old image query',
  async (decision) => {
    expect((await fixture.submit('rollback compatibility')).status).toBe(201);
    const submittedHistory =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
        where: {
          event: 'SUBMITTED',
          submission: { milestoneDocumentId: flowIds.document },
        },
        select: { id: true },
      });
    const response = await fixture.request(
      fixture.documentPath() +
        '/applications/' +
        flowIds.application +
        '/reviews',
      {
        actor: 'staff',
        method: 'POST',
        json: {
          decision,
          comment: 'retained rollback reason',
          expectedRevision: 1,
          expectedLatestReviewId: null,
        },
      },
    );
    expect(response.status).toBe(201);
    const event =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
        where: {
          submission: { milestoneDocumentId: flowIds.document },
          event: decision,
        },
      });
    const oldView =
      await fixture.prisma.milestoneDocumentSubmission.findUniqueOrThrow({
        where: { id: event.milestoneDocumentSubmissionId },
        select: {
          status: true,
          histories: {
            where: { revision: 1, event: 'SUBMITTED' },
            select: {
              id: true,
              revision: true,
              reviewHistories: {
                orderBy: { reviewedAt: 'desc' },
                select: {
                  id: true,
                  decision: true,
                  comment: true,
                  reviewerId: true,
                  reviewedAt: true,
                },
              },
            },
          },
        },
      });
    expect(oldView.status).toBe(decision);
    expect(oldView.histories).toEqual([
      {
        id: submittedHistory.id,
        revision: 1,
        reviewHistories: [
          {
            id: event.id,
            decision,
            comment: 'retained rollback reason',
            reviewerId: event.actorId,
            reviewedAt: event.createdAt,
          },
        ],
      },
    ]);
    expect(
      await fixture.prisma.milestoneDocumentReviewHistory.count({
        where: {
          milestoneDocumentSubmissionId: event.milestoneDocumentSubmissionId,
        },
      }),
    ).toBe(1);
    expect(
      await fixture.prisma.milestoneDocumentSubmissionHistory.count({
        where: {
          milestoneDocumentSubmissionId: event.milestoneDocumentSubmissionId,
          event: decision,
        },
      }),
    ).toBe(1);
  },
);

it('rolls back both review stores when the compatibility revision link fails', async () => {
  expect((await fixture.submit('atomic rollback')).status).toBe(201);
  const submission =
    await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
      where: { milestoneDocumentId: flowIds.document },
    });
  await expect(
    fixture.prisma.$transaction(async (transaction) => {
      await new PlatformRepository().appendSubmissionReviewEvent(transaction, {
        milestoneDocumentSubmissionId: submission.id,
        submissionHistoryId: 'missing-revision',
        revision: 1,
        reviewerId: flowIds.staff,
        decision: 'REJECTED',
        comment: null,
        reviewedAt: new Date(),
      });
      await transaction.milestoneDocumentSubmission.update({
        where: { id: submission.id },
        data: { status: 'REJECTED' },
      });
    }),
  ).rejects.toMatchObject({ code: 'P2003' });
  expect(
    await fixture.prisma.milestoneDocumentReviewHistory.count({
      where: { milestoneDocumentSubmissionId: submission.id },
    }),
  ).toBe(0);
  expect(
    await fixture.prisma.milestoneDocumentSubmissionHistory.count({
      where: {
        milestoneDocumentSubmissionId: submission.id,
        event: 'REJECTED',
      },
    }),
  ).toBe(0);
  expect(
    (
      await fixture.prisma.milestoneDocumentSubmission.findUniqueOrThrow({
        where: { id: submission.id },
      })
    ).status,
  ).toBe('SUBMITTED');
});
