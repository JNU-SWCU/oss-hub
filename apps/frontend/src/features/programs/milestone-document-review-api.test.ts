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
  reviewerNickname: '교직원',
};

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 판정을 「내가 본 그 제출물」에 묶는 두 값 — 본문에 늘 실린다. */
const version = {
  expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
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
          expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
          expectedLatestReviewId: 'review-0',
        }),
      },
    );
  });

  /**
   * 승인은 사유가 선택이다. `comment`를 넣지 않으면 본문에서 아예 빠져야 한다 —
   * `"comment":null`을 실어 보내면 백엔드 `@IsOptional() @IsString()`이 null을 문자열이
   * 아니라고 거절해 승인이 400으로 막힌다.
   */
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

  /**
   * 기대 버전 두 값은 **선택이 아니다**. 빠지면 백엔드가 400으로 막아 판정 자체가
   * 실패한다 — 이 계약이 어긋난 채로 배포되면 교직원 화면의 「판정 저장」이 통째로
   * 먹통이 된다(그래서 본문을 통째로 대조한다).
   */
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
      expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
      expectedLatestReviewId: 'review-0',
    });
  });

  /**
   * 아직 판정이 없던 칸. `null`은 **키째로 남아야** 한다 — 백엔드가 `@IsOptional`이 아니라
   * `@ValidateIf`로 받아 「안 보냄」을 400으로 막기 때문이다. `undefined`를 실으면
   * `JSON.stringify`가 키를 지워 그 400에 걸린다.
   */
  it('판정이 없던 칸은 expectedLatestReviewId에 명시된 null을 남긴다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created));
    vi.stubGlobal('fetch', fetchMock);

    await createMilestoneDocumentReview('milestone-1', 'document-1', 'app-1', {
      decision: 'APPROVED',
      expectedSubmittedAt: '2026-07-28T00:00:00.000Z',
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

  // 경로 세그먼트에 그대로 이어 붙이면 id에 `/`가 섞였을 때 남의 경로로 샌다.
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

  // 백엔드 `@MaxLength(2_000)`과 어긋나면 화면이 통과시킨 사유가 서버에서 잘린다.
  it('사유 길이 한도가 백엔드와 같다', () => {
    expect(MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH).toBe(2000);
  });

  /**
   * 「그 사이 판정이 등록됨」(024)과 「내가 본 그 제출물이 아님」(025)은 **다른 코드**다.
   * 하나로 접으면 화면이 두 자리에 같은 문구를 띄우게 되어 무엇이 바뀌었는지가 사라진다.
   */
  it('제출물이 바뀐 409와 판정이 바뀐 409를 다른 코드로 구분한다', () => {
    expect(MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED).toBe(
      'MSD_025',
    );
    expect(
      MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED,
    ).not.toBe(MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_CHANGED);
  });
});
