import { ReviewDecision } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
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
  `${fixture.documentPath()}/applications/${flowIds.application}/reviews`;

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

describe('QA152 current item submission HTTP + PostgreSQL + MinIO', () => {
  beforeAll(() => fixture.start());
  beforeEach(() => fixture.reset());
  afterAll(() => fixture.stop());

  it('requires a resubmission deadline before creating a changes request', async () => {
    expect((await fixture.submit('최초 제출')).status).toBe(201);
    const response = await fixture.request(reviewsPath(), {
      actor: 'staff',
      method: 'POST',
      json: {
        decision: ReviewDecision.CHANGES_REQUESTED,
        expectedRevision: 1,
        expectedLatestReviewId: null,
        comment: '보완해 주세요.',
      },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED,
    });
  });

  it('allows one post-deadline revision while preserving history and staff conflict checks', async () => {
    // Given: 교직원은 첫 제출을 보완 요청하고 검토 이력을 열어 둔다.
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
      await fixture.prisma.milestoneDocumentReviewHistory.findFirstOrThrow({
        where: {
          milestoneDocumentSubmission: {
            milestoneDocumentId: flowIds.document,
          },
        },
      });
    await fixture.closeDeadline();
    expect(
      (
        await fixture.request(
          `${fixture.documentPath()}/applications/${flowIds.application}/history`,
          { actor: 'staff' },
        )
      ).status,
    ).toBe(200);
    expect((await fixture.submit('첫 번째 보완')).status).toBe(201);

    // When: 한 번 재제출해 SUBMITTED로 바뀐 뒤 다시 보완을 낸다.
    const response = await fixture.submit('두 번째 보완');

    // Then
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
            select: { revision: true, content: true },
          },
          reviewHistories: { select: { id: true } },
        },
      });
    expect(submission).toMatchObject({
      revision: 2,
      status: 'SUBMITTED',
      reviewHistories: [{ id: requested.id }],
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
      // Given
      await fixture.submit('최초 제출');
      await review(ReviewDecision.CHANGES_REQUESTED, {
        expectedRevision: 1,
        expectedLatestReviewId: null,
        comment: '보완해 주세요.',
      });
      const requested =
        await fixture.prisma.milestoneDocumentReviewHistory.findFirstOrThrow({
          where: {
            milestoneDocumentSubmission: {
              milestoneDocumentId: flowIds.document,
            },
          },
        });
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

      // When / Then
      const response = await fixture.submit('최종 판정 뒤 변경');
      expect(response.status).toBe(409);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        code: MilestoneDocumentsErrorCode.RESUBMISSION_NOT_ALLOWED,
      });
    },
  );

  it('rejects a late revision without a changes request', async () => {
    // Given
    await fixture.submit('최초 제출');
    await fixture.closeDeadline();

    // When / Then
    const response = await fixture.submit('일반 마감 후 변경');
    expect(response.status).toBe(422);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      code: MilestoneDocumentsErrorCode.SUBMISSION_REPLACEMENT_CLOSED,
    });
  });

  it('requires rejection reasons and exposes the accepted reason in student history', async () => {
    // Given
    await fixture.submit('최초 제출');
    const version = {
      expectedRevision: 1,
      expectedLatestReviewId: null,
      comment: '   ',
    };
    const empty = await review(ReviewDecision.REJECTED, version);
    expect(empty.status).toBe(422);

    // When
    expect(
      (
        await review(ReviewDecision.REJECTED, {
          ...version,
          comment: '필수 실행 결과가 없습니다.',
        })
      ).status,
    ).toBe(201);

    // Then
    const history = await fixture.request(`${fixture.documentPath()}/history`);
    const body: unknown = await history.json();
    expect(body).toHaveProperty(
      'items',
      expect.arrayContaining([
        expect.objectContaining({
          event: 'REJECTED',
          comment: '필수 실행 결과가 없습니다.',
        }),
      ]),
    );
  });

  it('rejects an empty submission', async () => {
    // Given / When / Then
    expect((await fixture.submit('   ')).status).toBe(422);
  });
});
