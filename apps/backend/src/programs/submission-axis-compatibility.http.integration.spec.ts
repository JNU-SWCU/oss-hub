import { FileMetadataRepository } from './files.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import { SubmissionMembershipChangedError } from './submissions.error';
import {
  SubmissionsRepository,
  SubmissionReviewsRepository,
} from './submissions.repository';
import { EventEmitter, once } from 'node:events';
import {
  MilestoneDocumentCollectionReadRepository,
  RequirementsRepository,
} from './requirements.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from './milestone-document-flow.integration-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const fixture = new MilestoneDocumentFlowFixture();
const platform = new PlatformRepository();
const writeRepository = new RequirementsRepository(
  fixture.prisma,
  new LockProgramTreeRepository(),
  platform,
  new SubmissionsRepository(platform, new FileMetadataRepository()),
  new MilestoneDocumentCollectionReadRepository(
    fixture.prisma,
    new FileMetadataRepository(),
  ),
  new FileMetadataRepository(),
);
beforeAll(() => fixture.start());
beforeEach(async () => {
  await fixture.reset();
  await fixture.prisma.requirement.update({
    where: { id: flowIds.document },
    data: { submissionType: 'TEXT' },
  });
});
afterAll(() => fixture.stop());
it('holds the submission row lock before reading the item review version', async () => {
  expect((await fixture.submit('initial content')).status).toBe(201);
  const repository = new RequirementsRepository(
    fixture.prisma,
    new LockProgramTreeRepository(),
    new PlatformRepository(),
    new SubmissionsRepository(
      new PlatformRepository(),
      new FileMetadataRepository(),
    ),
    new MilestoneDocumentCollectionReadRepository(
      fixture.prisma,
      new FileMetadataRepository(),
    ),
    new FileMetadataRepository(),
  );
  const contender = new PrismaService();
  try {
    await repository.withTransaction(async (store) => {
      await store.lockDocument(flowIds.document);
      await store.findSubmissionForReview(flowIds.document, flowIds.team);
      await expect(contender.$queryRaw`
        SELECT "id" FROM "MilestoneDocumentSubmission"
        WHERE "milestoneDocumentId" = ${flowIds.document}
          AND "teamId" = ${flowIds.team}
        FOR UPDATE NOWAIT
      `).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    });
  } finally {
    await contender.$disconnect();
  }
});
it('returns all requirements in the ordinary document list', async () => {
  const response = await fixture.request(
    `milestones/${flowIds.milestone}/documents`,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    documents: [expect.objectContaining({ id: flowIds.document })],
  });
});
it('returns the current submission and latest review through the requirement list', async () => {
  expect((await fixture.submit('checklist content')).status).toBe(201);
  const reviewed = await fixture.request(
    fixture.documentPath() + '/teams/' + flowIds.team + '/reviews',
    {
      actor: 'staff',
      method: 'POST',
      json: {
        decision: 'CHANGES_REQUESTED',
        comment: 'checklist review',
        expectedRevision: 1,
        expectedLatestReviewId: null,
      },
    },
  );
  expect(reviewed.status).toBe(201);
  const response = await fixture.request(
    `milestones/${flowIds.milestone}/documents`,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    documents: [
      {
        id: flowIds.document,
        viewerSubmission: {
          status: 'CHANGES_REQUESTED',
          review: { comment: 'checklist review' },
        },
      },
    ],
  });
});
it('keeps the existing public PK and history when the requirement API replaces a submission', async () => {
  expect((await fixture.submit('original content')).status).toBe(201);
  const original = await fixture.prisma.submission.findFirstOrThrow({
    where: { requirementId: flowIds.document },
  });
  const publicId = 'synthetic-public-submission';
  await fixture.prisma.submission.update({
    where: { id: original.id },
    data: { id: publicId },
  });
  expect(
    (
      await fixture.request(fixture.documentPath() + '/submissions', {
        method: 'POST',
        json: {
          content: { text: 'replacement content' },
          expectedRevision: 1,
          expectedLatestReviewId: null,
        },
      })
    ).status,
  ).toBe(201);
  const response = await fixture.request(
    `submissions/${publicId}/review-context`,
    { actor: 'staff' },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    requirementId: flowIds.document,
    submissionId: publicId,
    currentRevision: { number: 2 },
    history: [{ number: 1 }],
  });
  expect(
    await fixture.prisma.submission.count({
      where: {
        requirementId: flowIds.document,
        teamId: flowIds.team,
      },
    }),
  ).toBe(1);
});
it('rejects a stale requirement review after another reviewer decides the same revision', async () => {
  expect((await fixture.submit('initial content')).status).toBe(201);
  const path = fixture.documentPath() + '/teams/' + flowIds.team + '/reviews';
  expect(
    (
      await fixture.request(path, {
        actor: 'staff',
        method: 'POST',
        json: {
          decision: 'APPROVED',
          expectedRevision: 1,
          expectedLatestReviewId: null,
        },
      })
    ).status,
  ).toBe(201);
  const stale = await fixture.request(path, {
    actor: 'staff',
    method: 'POST',
    json: {
      decision: 'CHANGES_REQUESTED',
      expectedRevision: 1,
      expectedLatestReviewId: null,
    },
  });
  expect(stale.status).toBe(409);
  expect(
    await fixture.prisma.submissionHistory.count({
      where: {
        submission: { requirementId: flowIds.document },
        event: { in: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] },
      },
    }),
  ).toBe(1);
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
  const submission = await fixture.prisma.submission.findFirstOrThrow({
    where: { requirementId: flowIds.document },
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
  const history = await fixture.prisma.submissionHistory.findFirstOrThrow({
    where: {
      submission: { requirementId: flowIds.document },
      event: 'SUBMITTED',
    },
    select: { comment: true },
  });
  expect(history.comment).toBeNull();
});
it.each(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const)(
  'shows each canonical %s review event without the retired review model',
  async (decision) => {
    expect((await fixture.submit('canonical review')).status).toBe(201);
    const reviewed = await fixture.request(
      fixture.documentPath() + '/teams/' + flowIds.team + '/reviews',
      {
        actor: 'staff',
        method: 'POST',
        json: {
          decision,
          comment: 'retained review reason',
          expectedRevision: 1,
          expectedLatestReviewId: null,
        },
      },
    );
    expect(reviewed.status).toBe(201);
    const submission = await fixture.prisma.submission.findFirstOrThrow({
      where: { requirementId: flowIds.document },
    });
    expect(submission.status).toBe(decision);
    const response = await fixture.request(
      `submissions/${submission.id}/review-context`,
      { actor: 'staff' },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      requirementId: flowIds.document,
      currentRevision: {
        number: 1,
        review: { decision, comment: 'retained review reason' },
      },
    });
    expect(
      await fixture.prisma.submissionHistory.count({
        where: {
          submissionId: submission.id,
          event: decision,
        },
      }),
    ).toBe(1);
  },
);
it('rolls back the review event when updating the submission fails', async () => {
  expect((await fixture.submit('atomic rollback')).status).toBe(201);
  const submission = await fixture.prisma.submission.findFirstOrThrow({
    where: { requirementId: flowIds.document },
  });
  const history = await fixture.prisma.submissionHistory.findFirstOrThrow({
    where: {
      submissionId: submission.id,
      event: 'SUBMITTED',
    },
  });
  await expect(
    fixture.prisma.$transaction(async (transaction) => {
      await new PlatformRepository().appendSubmissionReviewEvent(transaction, {
        milestoneDocumentSubmissionId: submission.id,
        submissionHistoryId: history.id,
        revision: 1,
        reviewerId: flowIds.staff,
        decision: 'REJECTED',
        comment: null,
        reviewedAt: new Date(),
      });
      await transaction.submission.update({
        where: { id: 'missing-submission' },
        data: { status: 'REJECTED' },
      });
    }),
  ).rejects.toMatchObject({ code: 'P2025' });
  expect(
    await fixture.prisma.submissionHistory.count({
      where: {
        submissionId: submission.id,
        event: 'REJECTED',
      },
    }),
  ).toBe(0);
  expect(
    (
      await fixture.prisma.submission.findUniqueOrThrow({
        where: { id: submission.id },
      })
    ).status,
  ).toBe('SUBMITTED');
});
it.each(['create', 'replace', 'review', 'bulk-review'] as const)(
  'rejects %s writes to a DELETED program without changing submission records',
  async (operation) => {
    if (operation !== 'create')
      expect((await fixture.submit('preserve existing revision')).status).toBe(
        201,
      );
    const bulkPath =
      'programs/' + flowIds.program + '/documents/change-requests';
    let expectedVersion: string | undefined;
    if (operation === 'bulk-review') {
      const targets = await fixture.request(
        bulkPath + '/targets?scope=PROGRAM',
        { actor: 'staff' },
      );
      expect(targets.status).toBe(200);
      const body: unknown = await targets.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('version' in body) ||
        typeof body.version !== 'string'
      )
        throw new Error('Missing bulk version');
      expectedVersion = body.version;
    }
    const where = { requirementId: flowIds.document };
    const before = await fixture.prisma.submission.findMany({
      where,
      include: { histories: true },
    });
    await fixture.prisma.program.update({
      where: { id: flowIds.program },
      data: { lifecycle: 'DELETED' },
    });
    const response =
      operation === 'review'
        ? await fixture.request(
            fixture.documentPath() + '/teams/' + flowIds.team + '/reviews',
            {
              actor: 'staff',
              method: 'POST',
              json: {
                decision: 'APPROVED',
                comment: 'must not persist',
                expectedRevision: 1,
                expectedLatestReviewId: null,
              },
            },
          )
        : operation === 'bulk-review'
          ? await fixture.request(bulkPath, {
              actor: 'staff',
              method: 'POST',
              json: {
                scope: 'PROGRAM',
                includeFinalDecisions: false,
                expectedVersion,
                comment: 'must not persist',
              },
            })
          : await fixture.submit('must not persist');
    expect(response.status).toBe(
      operation === 'create' || operation === 'replace' ? 403 : 404,
    );
    expect(
      await fixture.prisma.submission.findMany({
        where,
        include: { histories: true },
      }),
    ).toEqual(before);
  },
);
it('rejects an admitted item submission if the program was deleted before its write transaction', async () => {
  await fixture.prisma.program.update({
    where: { id: flowIds.program },
    data: { lifecycle: 'DELETED' },
  });
  await expect(
    writeRepository.upsertSubmission({
      milestoneDocumentId: flowIds.document,
      teamId: flowIds.team,
      submittedById: flowIds.student,
      submittedAt: new Date(),
      content: { type: 'TEXT', text: 'must not persist' },
      attachFile: null,
      expectedLatestReviewId: null,
      deadline: {
        milestoneId: flowIds.milestone,
        allowAfterDeadline: false,
        expectedSubmissionStatus: null,
      },
    }),
  ).rejects.toBeInstanceOf(SubmissionMembershipChangedError);
  expect(
    await fixture.prisma.submission.count({
      where: { requirementId: flowIds.document },
    }),
  ).toBe(0);
});
it('rejects a bulk review write scope if the program was deleted after admission', async () => {
  await fixture.prisma.program.update({
    where: { id: flowIds.program },
    data: { lifecycle: 'DELETED' },
  });
  expect(
    await writeRepository.withTransaction((store) =>
      store.lockProgramForReview(flowIds.program),
    ),
  ).toBe(false);
});
it('serializes review commit before program deletion with two transactions and no sleeps', async () => {
  expect((await fixture.submit('legacy delete race')).status).toBe(201);
  const submission = await fixture.prisma.submission.findFirstOrThrow({
    where: { requirementId: flowIds.document },
  });
  const repository = new SubmissionReviewsRepository(fixture.prisma, platform);
  const contender = new PrismaService();
  await contender.$connect();
  const signals = new EventEmitter();
  const targetReady = once(signals, 'target-ready');
  const continueReview = once(signals, 'continue-review');
  const reviewCommitted = once(signals, 'review-committed');
  const commits: string[] = [];
  let deleteWasBlocked = false;
  const review = repository
    .withTransaction(async (store) => {
      const target = await store.findReviewTarget(submission.id);
      if (target === null) throw new Error('Expected live review target');
      signals.emit('target-ready');
      await continueReview;
      await store.createReview({
        milestoneDocumentSubmissionId: target.id,
        submissionHistoryId: target.revision.id,
        revision: target.currentRevision,
        reviewerId: flowIds.staff,
        decision: 'APPROVED',
        comment: 'race review',
        reviewedAt: new Date(),
      });
      expect(
        await store.transitionSubmission({
          submissionId: target.id,
          expectedRevision: target.currentRevision,
          nextStatus: 'APPROVED',
        }),
      ).toBe(true);
    })
    .then(() => {
      commits.push('review');
      signals.emit('review-committed');
    });
  const deletion = (async () => {
    await Promise.race([targetReady, review]);
    await contender.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe('SAVEPOINT legacy_review_delete');
      try {
        await transaction.$queryRawUnsafe(
          'SELECT "id" FROM "Program" WHERE "id" = $1 FOR UPDATE NOWAIT',
          flowIds.program,
        );
      } catch (error) {
        expect(error).toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
        deleteWasBlocked = true;
        await transaction.$executeRawUnsafe(
          'ROLLBACK TO SAVEPOINT legacy_review_delete',
        );
      }
      if (deleteWasBlocked) {
        signals.emit('continue-review');
        await Promise.race([reviewCommitted, review]);
        await transaction.$queryRawUnsafe(
          'SELECT "id" FROM "Program" WHERE "id" = $1 FOR UPDATE',
          flowIds.program,
        );
      }
      await transaction.program.update({
        where: { id: flowIds.program },
        data: { lifecycle: 'DELETED' },
      });
    });
    commits.push('delete');
    if (!deleteWasBlocked) signals.emit('continue-review');
  })();
  try {
    await Promise.all([review, deletion]);
  } finally {
    signals.emit('continue-review');
    await Promise.allSettled([review, deletion]);
    signals.removeAllListeners();
    await contender.$disconnect();
  }
  expect(commits).toEqual(['review', 'delete']);
  expect(deleteWasBlocked).toBe(true);
  expect(
    (
      await fixture.prisma.program.findUniqueOrThrow({
        where: { id: flowIds.program },
      })
    ).lifecycle,
  ).toBe('DELETED');
  expect(
    (
      await fixture.prisma.submission.findUniqueOrThrow({
        where: { id: submission.id },
      })
    ).status,
  ).toBe('APPROVED');
  const event = await fixture.prisma.submissionHistory.findFirstOrThrow({
    where: {
      submissionId: submission.id,
      event: 'APPROVED',
    },
  });
  expect(event.revision).toBe(1);
  expect(
    await fixture.prisma.submissionHistory.count({
      where: {
        submissionId: submission.id,
        event: 'APPROVED',
        revision: 1,
      },
    }),
  ).toBe(1);
});
