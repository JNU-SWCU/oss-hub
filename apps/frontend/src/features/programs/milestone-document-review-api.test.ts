import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  createMilestoneDocumentReview,
  MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH,
  MILESTONE_DOCUMENT_REVIEW_DECISIONS,
  MILESTONE_DOCUMENT_REVIEW_ERROR_CODES,
  type CreatedMilestoneDocumentReview,
} from './milestone-document-review-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const created: CreatedMilestoneDocumentReview = {
  id: 'review-1',
  decision: 'CHANGES_REQUESTED',
  comment: '표지의 이름이 다릅니다.',
  reviewedAt: '2026-08-01T02:00:00.000Z',
  resubmissionDueAt: null,
  reviewerNickname: '교직원',
};

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const version = {
  expectedRevision: 2,
  expectedLatestReviewId: 'review-0',
} as const;

describe('createMilestoneDocumentReview', () => {
  it('마일스톤·서류·신청 세 id를 경로에 실어 POST한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createMilestoneDocumentReview('milestone-1', 'document-1', 'app-1', {
        decision: 'CHANGES_REQUESTED',
        comment: '표지의 이름이 다릅니다.',
        ...version,
      }),
    ).resolves.toEqual(created);

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath(
        'milestones/milestone-1/documents/document-1/applications/app-1/reviews',
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'CHANGES_REQUESTED',
          comment: '표지의 이름이 다릅니다.',
          expectedRevision: 2,
          expectedLatestReviewId: 'review-0',
        }),
      },
    );
  });

  it('사유가 없으면 본문에 comment 키를 만들지 않는다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...created, decision: 'APPROVED' }));
    vi.stubGlobal('fetch', fetchMock);

    await createMilestoneDocumentReview('milestone-1', 'document-1', 'app-1', {
      decision: 'APPROVED',
      ...version,
    });

    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(JSON.parse(body)).toEqual({ decision: 'APPROVED', ...version });
    expect(body).not.toContain('comment');
  });

  it('기대 버전 두 값을 본문에 함께 싣는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created));
    vi.stubGlobal('fetch', fetchMock);

    await createMilestoneDocumentReview('milestone-1', 'document-1', 'app-1', {
      decision: 'REJECTED',
      comment: '기한을 넘겼습니다.',
      ...version,
    });

    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(JSON.parse(body)).toEqual({
      decision: 'REJECTED',
      comment: '기한을 넘겼습니다.',
      expectedRevision: 2,
      expectedLatestReviewId: 'review-0',
    });
  });

  it('판정이 없던 칸은 expectedLatestReviewId에 명시된 null을 남긴다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created));
    vi.stubGlobal('fetch', fetchMock);

    await createMilestoneDocumentReview('milestone-1', 'document-1', 'app-1', {
      decision: 'APPROVED',
      expectedRevision: 1,
      expectedLatestReviewId: null,
    });

    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(body).toContain('"expectedLatestReviewId":null');
    expect(
      Object.hasOwn(
        JSON.parse(body) as Record<string, unknown>,
        'expectedLatestReviewId',
      ),
    ).toBe(true);
  });

  it('id를 경로에 넣기 전에 인코딩한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created));
    vi.stubGlobal('fetch', fetchMock);

    await createMilestoneDocumentReview('m/1', 'd/1', 'a/1', {
      decision: 'REJECTED',
      comment: '기한을 넘겼습니다.',
      ...version,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('milestones/m%2F1/documents/d%2F1/applications/a%2F1/reviews'),
      expect.anything(),
    );
  });
});

describe('판정 계약 상수', () => {
  it('백엔드 ReviewDecision 세 값과 같다', () => {
    expect([...MILESTONE_DOCUMENT_REVIEW_DECISIONS]).toEqual([
      'APPROVED',
      'CHANGES_REQUESTED',
      'REJECTED',
    ]);
  });

  it('사유 길이 한도가 백엔드와 같다', () => {
    expect(MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH).toBe(2000);
  });

  it('제출물이 바뀐 409와 판정이 바뀐 409를 다른 코드로 구분한다', () => {
    expect(MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED).toBe(
      'MSD_025',
    );
    expect(
      MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED,
    ).not.toBe(MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_CHANGED);
  });
});
