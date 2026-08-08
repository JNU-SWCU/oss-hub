import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import {
  createMilestoneDocumentReview,
  MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH,
  MILESTONE_DOCUMENT_REVIEW_DECISIONS,
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

describe('createMilestoneDocumentReview', () => {
  it('마일스톤·서류·신청 세 id를 경로에 실어 POST한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createMilestoneDocumentReview('milestone-1', 'document-1', 'app-1', {
        decision: 'CHANGES_REQUESTED',
        comment: '표지의 이름이 다릅니다.',
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
    });

    const body = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(JSON.parse(body)).toEqual({ decision: 'APPROVED' });
    expect(body).not.toContain('comment');
  });

  // 경로 세그먼트에 그대로 이어 붙이면 id에 `/`가 섞였을 때 남의 경로로 샌다.
  it('id를 경로에 넣기 전에 인코딩한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(created));
    vi.stubGlobal('fetch', fetchMock);

    await createMilestoneDocumentReview('m/1', 'd/1', 'a/1', {
      decision: 'REJECTED',
      comment: '기한을 넘겼습니다.',
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
});
