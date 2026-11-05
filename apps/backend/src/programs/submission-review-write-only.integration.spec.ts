import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PlatformRepository } from '../platform/platform.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentSubmissionRepository } from './submissions.repository';
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
  new MilestoneDocumentSubmissionRepository(platform),
  collection,
);

beforeAll(() => fixture.start());
beforeEach(() => fixture.reset());
afterAll(() => fixture.stop());

it.each(['previous', 'current'])(
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
    if (storage === 'previous') {
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
      await fixture.prisma.milestoneDocumentReviewHistory.create({
        data: {
          id: 'synthetic-previous-review',
          milestoneDocumentSubmissionId:
            submitted.milestoneDocumentSubmissionId,
          submissionHistoryId: submitted.id,
          reviewerId: flowIds.staff,
          decision: 'CHANGES_REQUESTED',
          comment: 'preserved review comment',
          reviewedAt,
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
    expect(
      await fixture.prisma.milestoneDocumentReviewHistory.count({
        where: {
          milestoneDocumentSubmissionId:
            submitted.milestoneDocumentSubmissionId,
        },
      }),
    ).toBe(storage === 'previous' ? 1 : 0);
    const expected = {
      id: review.id,
      decision: 'CHANGES_REQUESTED',
      comment: 'preserved review comment',
      reviewedAt: review.createdAt,
      resubmissionDueAt: null,
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
