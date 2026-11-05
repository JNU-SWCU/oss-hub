import { ReviewDecision } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.error';
import {
  MilestoneDocumentFlowFixture,
  flowIds,
} from './milestone-document-flow.integration-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const fixture = new MilestoneDocumentFlowFixture();
const reviewsPath = () =>
  `${fixture.documentPath()}/teams/${flowIds.team}/reviews`;

async function review(
  decision: ReviewDecision,
  version: {
    readonly expectedRevision: number;
    readonly expectedLatestReviewId: string | null;
    readonly comment?: string;
  },
): Promise<Response> {
  return fixture.request(reviewsPath(), {
    actor: 'staff',
    method: 'POST',
    json: {
      decision,
      ...(decision === ReviewDecision.CHANGES_REQUESTED
        ? { resubmissionDueAt: '2099-12-31T00:00:00.000Z' }
        : {}),
      ...version,
    },
  });
}

describe('QA152 current item submission HTTP + PostgreSQL + object-storage', () => {
  beforeAll(() => fixture.start());
  beforeEach(() => fixture.reset());
  afterAll(() => fixture.stop());

  it('stores one review event without a compatibility row and returns it to staff and students', async () => {
    expect((await fixture.submit('최초 제출')).status).toBe(201);

    const response = await review(ReviewDecision.CHANGES_REQUESTED, {
      expectedRevision: 1,
      expectedLatestReviewId: null,
      comment: '보완해 주세요.',
    });

    expect(response.status).toBe(201);
    const events =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findMany({
        where: { submission: { milestoneDocumentId: flowIds.document } },
        orderBy: { createdAt: 'asc' },
        select: { event: true, revision: true },
      });
    expect(events).toEqual([
      { event: 'SUBMITTED', revision: 1 },
      {
        event: 'CHANGES_REQUESTED',
        revision: 1,
      },
    ]);
    for (const [path, actor] of [
      [`${fixture.documentPath()}/history`, 'student'],
      [`${fixture.documentPath()}/teams/${flowIds.team}/history`, 'staff'],
    ] as const) {
      const history = await fixture.request(path, { actor });
      expect(history.status).toBe(200);
      expect(await history.json()).toHaveProperty(
        'items',
        expect.arrayContaining([
          expect.objectContaining({
            event: 'CHANGES_REQUESTED',
            revision: 1,
            comment: '보완해 주세요.',
          }),
        ]),
      );
    }
  });

  it('accepts a changes request without reason or resubmission deadline', async () => {
    expect((await fixture.submit('최초 제출')).status).toBe(201);
    const response = await fixture.request(reviewsPath(), {
      actor: 'staff',
      method: 'POST',
      json: {
        decision: ReviewDecision.CHANGES_REQUESTED,
        expectedRevision: 1,
        expectedLatestReviewId: null,
      },
    });
    expect(response.status).toBe(201);
    const history =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
        where: {
          event: 'CHANGES_REQUESTED',
          submission: { milestoneDocumentId: flowIds.document },
        },
      });
    expect(history.comment).toBeNull();
    await fixture.closeDeadline();
    expect((await fixture.submit('기한 없이 보완')).status).toBe(201);
  });

  it('allows one post-deadline revision while preserving history and staff conflict checks', async () => {
    expect((await fixture.submit('최초 제출')).status).toBe(201);
    expect(
      (
        await review(ReviewDecision.CHANGES_REQUESTED, {
          expectedRevision: 1,
          expectedLatestReviewId: null,
          comment: '실행 결과를 보완해 주세요.',
        })
      ).status,
    ).toBe(201);
    const requested =
      await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow({
        where: {
          event: 'CHANGES_REQUESTED',
          submission: {
            milestoneDocumentId: flowIds.document,
          },
        },
      });
    await fixture.closeDeadline();
    expect(
      (
        await fixture.request(
          `${fixture.documentPath()}/teams/${flowIds.team}/history`,
          { actor: 'staff' },
        )
      ).status,
    ).toBe(200);
    expect((await fixture.submit('첫 번째 보완')).status).toBe(201);

    const response = await fixture.submit('두 번째 보완');

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED,
    });
    const submission =
      await fixture.prisma.milestoneDocumentSubmission.findFirstOrThrow({
        where: { milestoneDocumentId: flowIds.document },
        select: {
          revision: true,
          status: true,
          histories: {
            orderBy: { revision: 'asc' },
            select: { id: true, event: true, revision: true, content: true },
          },
        },
      });
    expect(submission).toMatchObject({
      revision: 2,
      status: 'SUBMITTED',
    });
    expect(submission.histories).toContainEqual({
      id: requested.id,
      event: 'CHANGES_REQUESTED',
      revision: 1,
      content: null,
    });
    expect(
      submission.histories
        .filter((entry) => entry.content !== null)
        .map((entry) => entry.content),
    ).toEqual([
      { type: 'TEXT', text: '최초 제출' },
      { type: 'TEXT', text: '첫 번째 보완' },
    ]);
    const stale = await review(ReviewDecision.APPROVED, {
      expectedRevision: 1,
      expectedLatestReviewId: requested.id,
    });
    expect(stale.status).toBe(409);
    const staleBody: unknown = await stale.json();
    expect(staleBody).toMatchObject({
      code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED,
    });
  });

  it.each([ReviewDecision.APPROVED, ReviewDecision.REJECTED])(
    'blocks new revisions after final %s without deleting history',
    async (decision) => {
      await fixture.submit('최초 제출');
      await review(ReviewDecision.CHANGES_REQUESTED, {
        expectedRevision: 1,
        expectedLatestReviewId: null,
      });
      const requested =
        await fixture.prisma.milestoneDocumentSubmissionHistory.findFirstOrThrow(
          {
            where: {
              event: 'CHANGES_REQUESTED',
              submission: {
                milestoneDocumentId: flowIds.document,
              },
            },
          },
        );
      await fixture.closeDeadline();
      await fixture.submit('보완 제출');
      expect(
        (
          await review(decision, {
            expectedRevision: 2,
            expectedLatestReviewId: requested.id,
            comment: '최종 검토 사유',
          })
        ).status,
      ).toBe(201);

      const response = await fixture.submit('최종 판정 뒤 변경');
      expect(response.status).toBe(409);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        code: MilestoneDocumentsErrorCode.RESUBMISSION_NOT_ALLOWED,
      });
    },
  );

  it('rejects a late revision without a changes request', async () => {
    await fixture.submit('최초 제출');
    await fixture.closeDeadline();

    const response = await fixture.submit('일반 마감 후 변경');
    expect(response.status).toBe(422);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      code: MilestoneDocumentsErrorCode.SUBMISSION_REPLACEMENT_CLOSED,
    });
  });

  it.each(['   ', '필수 실행 결과가 없습니다.'])(
    'accepts an optional rejection reason and exposes the stored comment: %s',
    async (comment) => {
      expect((await fixture.submit('최초 제출')).status).toBe(201);
      const response = await review(ReviewDecision.REJECTED, {
        expectedRevision: 1,
        expectedLatestReviewId: null,
        comment,
      });
      expect(response.status).toBe(201);
      const history = await fixture.request(
        fixture.documentPath() + '/history',
      );
      expect(history.status).toBe(200);
      expect(await history.json()).toHaveProperty(
        'items',
        expect.arrayContaining([
          expect.objectContaining({
            event: 'REJECTED',
            comment: comment.trim() || null,
          }),
        ]),
      );
    },
  );

  it('rejects an empty submission', async () => {
    expect((await fixture.submit('   ')).status).toBe(422);
  });
});
