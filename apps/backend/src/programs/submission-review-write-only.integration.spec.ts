import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PlatformRepository } from '../platform/platform.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { SubmissionsRepository } from './submissions.repository';
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
const collection = new MilestoneDocumentCollectionReadRepository(
  fixture.prisma,
);
const repository = new MilestoneDocumentsRepository(
  fixture.prisma,
  new LockProgramTreeRepository(),
  platform,
  new SubmissionsRepository(platform),
  collection,
);
beforeAll(() => fixture.start());
beforeEach(() => fixture.reset());
afterAll(() => fixture.stop());
it('hides a generic submission review context after program deletion', async () => {
  expect((await fixture.submit('ordinary submission')).status).toBe(201);
  const submission =
    await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
      where: { milestoneDocumentId: flowIds.document },
      select: { id: true },
    });
  await fixture.prisma.program.update({
    where: { id: flowIds.program },
    data: { lifecycle: 'DELETED' },
  });
  const response = await fixture.request(
    `submissions/${submission.id}/review-context`,
    {
      actor: 'staff',
    },
  );
  expect(response.status).toBe(404);
  expect(
    await fixture.prisma.milestoneDocumentSubmissionHistory.count({
      where: { milestoneDocumentSubmissionId: submission.id },
    }),
  ).toBe(1);
});
it.each([
  ['POST', 'submissions'],
  ['POST', 'submissions/retired/resubmissions'],
  ['POST', 'submissions/retired/reviews'],
  ['POST', 'submission-files'],
  ['GET', `programs/${flowIds.program}/submissions/me`],
  [
    'GET',
    `programs/${flowIds.program}/milestones/${flowIds.milestone}/submission-form`,
  ],
])('retires the milestone-only endpoint %s %s', async (method, endpoint) => {
  const response = await fixture.request(endpoint, {
    actor: 'staff',
    method,
    ...(method === 'POST' ? { json: {} } : {}),
  });
  expect(response.status).toBe(404);
});
it('shows the historical approval with an unknown revision without rewriting the event', async () => {
  expect((await fixture.submit('historical submission')).status).toBe(201);
  const submission =
    await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
      where: { milestoneDocumentId: flowIds.document },
    });
  await fixture.prisma.milestoneDocument.update({
    where: { id: flowIds.document },
    data: { submissionType: 'TEXT' },
  });
  const reviewedAt = new Date('2026-01-15T12:00:00Z');
  const event = await fixture.prisma.milestoneDocumentSubmissionHistory.create({
    data: {
      id: 'synthetic-unlinked-historical-approval',
      milestoneDocumentSubmissionId: submission.id,
      event: 'APPROVED',
      revision: null,
      actorId: flowIds.staff,
      comment: 'historical approval',
      createdAt: reviewedAt,
    },
  });
  await fixture.prisma.milestoneDocumentSubmission.update({
    where: { id: submission.id },
    data: { status: 'APPROVED' },
  });
  const response = await fixture.request(
    `submissions/${submission.id}/review-context`,
    { actor: 'staff' },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    submissionId: submission.id,
    latestReviewId: event.id,
    currentRevision: {
      number: submission.revision,
      review: null,
    },
    unversionedReviews: [
      {
        id: event.id,
        decision: 'APPROVED',
        comment: event.comment,
        reviewedAt: reviewedAt.toISOString(),
      },
    ],
  });
  const viewer = await fixture.request(
    `milestones/${flowIds.milestone}/documents`,
  );
  expect(viewer.status).toBe(200);
  expect(await viewer.json()).toMatchObject({
    documents: [
      {
        id: flowIds.document,
        viewerSubmission: {
          status: 'APPROVED',
          review: {
            comment: event.comment,
            reviewedAt: reviewedAt.toISOString(),
          },
        },
      },
    ],
  });
  const snapshot = await collection.withSnapshot((store) =>
    store.findDetails([flowIds.document], [flowIds.application], new Date()),
  );
  expect(snapshot.map((item) => item.review)).toEqual([
    {
      id: event.id,
      decision: 'APPROVED',
      comment: event.comment,
      reviewedAt,
    },
  ]);
  const next = await fixture.request(
    fixture.documentPath() +
      '/applications/' +
      flowIds.application +
      '/reviews',
    {
      actor: 'staff',
      method: 'POST',
      json: {
        decision: 'APPROVED',
        expectedRevision: submission.revision,
        expectedLatestReviewId: event.id,
      },
    },
  );
  expect(next.status).toBe(201);
  expect(
    await fixture.prisma.milestoneDocumentSubmissionHistory.count({
      where: {
        milestoneDocumentSubmissionId: submission.id,
        revision: submission.revision,
        event: 'APPROVED',
      },
    }),
  ).toBe(1);
  expect(
    await fixture.prisma.milestoneDocumentSubmissionHistory.findUnique({
      where: { id: event.id },
    }),
  ).toEqual(event);
  expect(
    await fixture.prisma.milestoneDocumentSubmission.findUnique({
      where: { id: submission.id },
      select: { status: true, revision: true },
    }),
  ).toEqual({ status: 'APPROVED', revision: submission.revision });
});
it.each(['prepared', 'current'])(
  'returns the same review fields from %s review storage',
  async (storage) => {
    expect((await fixture.submit('review storage compatibility')).status).toBe(
      201,
    );
    const submitted =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
        where: {
          submission: { milestoneDocumentId: flowIds.document },
          event: 'SUBMITTED',
        },
      });
    if (storage === 'prepared') {
      const reviewedAt = new Date();
      await fixture.prisma.milestoneDocumentSubmissionHistory.create({
        data: {
          id: 'synthetic-previous-review',
          milestoneDocumentSubmissionId:
            submitted.milestoneDocumentSubmissionId,
          event: 'CHANGES_REQUESTED',
          revision: 1,
          actorId: flowIds.staff,
          comment: 'preserved review comment',
          createdAt: reviewedAt,
        },
      });
      await fixture.prisma.milestoneDocumentSubmission.update({
        where: { id: submitted.milestoneDocumentSubmissionId },
        data: { status: 'CHANGES_REQUESTED' },
      });
    } else {
      const response = await fixture.request(
        `${fixture.documentPath()}/applications/${flowIds.application}/reviews`,
        {
          actor: 'staff',
          method: 'POST',
          json: {
            decision: 'CHANGES_REQUESTED',
            comment: 'preserved review comment',
            expectedRevision: 1,
            expectedLatestReviewId: null,
          },
        },
      );
      expect(response.status).toBe(201);
    }
    const reviews =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findMany({
        where: {
          milestoneDocumentSubmissionId:
            submitted.milestoneDocumentSubmissionId,
          event: 'CHANGES_REQUESTED',
        },
      });
    expect(reviews).toHaveLength(1);
    const review = reviews[0];
    if (review === undefined) throw new Error('Expected one review event');
    const expected = {
      id: review.id,
      decision: 'CHANGES_REQUESTED',
      comment: 'preserved review comment',
      reviewedAt: review.createdAt,
    };
    const now = new Date();
    const summaries = await repository.findSubmittedSummaries(
      flowIds.application,
      [flowIds.document],
      now,
    );
    expect(summaries.map((item) => item.review)).toEqual([expected]);
    const details = await repository.findSubmissionsForCollection(
      [flowIds.document],
      now,
      [flowIds.application],
    );
    expect(details.map((item) => item.review)).toEqual([expected]);
    const snapshot = await collection.withSnapshot((store) =>
      store.findDetails([flowIds.document], [flowIds.application], now),
    );
    expect(snapshot.map((item) => item.review)).toEqual([expected]);
    const legacySnapshot = await repository.withCollectionSnapshot((store) =>
      store.findSubmissionsForCollection([flowIds.document], now, [
        flowIds.application,
      ]),
    );
    expect(legacySnapshot.map((item) => item.review)).toEqual([expected]);
    await expect(
      repository.findLatestReview(flowIds.document, flowIds.application),
    ).resolves.toEqual({ id: review.id, decision: 'CHANGES_REQUESTED' });
    await expect(
      repository.withTransaction((store) =>
        store.findLatestReviewIdForSubmission(
          submitted.milestoneDocumentSubmissionId,
        ),
      ),
    ).resolves.toBe(review.id);
  },
);

it('appends repeated decisions for one revision without overwriting the previous review', async () => {
  expect((await fixture.submit('append-only review')).status).toBe(201);
  const endpoint =
    fixture.documentPath() +
    '/applications/' +
    flowIds.application +
    '/reviews';
  const first = await fixture.request(endpoint, {
    actor: 'staff',
    method: 'POST',
    json: {
      decision: 'CHANGES_REQUESTED',
      comment: 'first decision',
      expectedRevision: 1,
      expectedLatestReviewId: null,
    },
  });
  expect(first.status).toBe(201);
  const previous =
    await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
      where: {
        submission: { milestoneDocumentId: flowIds.document },
        event: 'CHANGES_REQUESTED',
      },
    });
  const second = await fixture.request(endpoint, {
    actor: 'staff',
    method: 'POST',
    json: {
      decision: 'APPROVED',
      comment: 'second decision',
      expectedRevision: 1,
      expectedLatestReviewId: previous.id,
    },
  });
  expect(second.status).toBe(201);
  expect(
    await fixture.prisma.milestoneDocumentSubmissionHistory.findUnique({
      where: { id: previous.id },
    }),
  ).toEqual(previous);
  const reviews =
    await fixture.prisma.milestoneDocumentSubmissionHistory.findMany({
      where: {
        milestoneDocumentSubmissionId: previous.milestoneDocumentSubmissionId,
        event: { in: ['CHANGES_REQUESTED', 'APPROVED'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { event: true, revision: true, actorId: true, comment: true },
    });
  expect(reviews).toEqual([
    {
      event: 'CHANGES_REQUESTED',
      revision: 1,
      actorId: flowIds.staff,
      comment: 'first decision',
    },
    {
      event: 'APPROVED',
      revision: 1,
      actorId: flowIds.staff,
      comment: 'second decision',
    },
  ]);
});
