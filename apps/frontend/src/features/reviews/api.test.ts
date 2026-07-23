import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPath } from '@/lib/api-client';

import { createReview, getReviewContext, publishRepository } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reviews api', () => {
  it('submission id로 검토 문맥을 조회한다', async () => {
    // Given
    const response = {
      submissionId: 'submission-existing',
      application: {
        id: 'application-personal',
        applicationMode: 'PERSONAL',
        displayName: '합성 신청자',
      },
      milestone: { id: 'milestone-final', name: '최종 제출' },
      currentRevision: {
        number: 2,
        content: { repositoryUrl: 'https://example.com/repository' },
        comment: '수정했습니다.',
        submittedAt: '2026-09-27T01:00:00.000Z',
        review: null,
      },
      history: [],
      repository: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await getReviewContext('submission-existing');

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('submissions/submission-existing/review-context'),
      undefined,
    );
  });

  it('현재 revision과 판정을 함께 저장한다', async () => {
    // Given
    const response = {
      reviewId: 'review-synthetic',
      submissionStatus: 'CHANGES_REQUESTED',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await createReview('submission-existing', {
      revision: 2,
      decision: 'CHANGES_REQUESTED',
      comment: '실행 화면을 추가해 주세요.',
    });

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('submissions/submission-existing/reviews'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: 2,
          decision: 'CHANGES_REQUESTED',
          comment: '실행 화면을 추가해 주세요.',
        }),
      },
    );
  });

  it('repository id로 별도 공개 전환을 요청한다', async () => {
    // Given
    const response = {
      repositoryId: 'repository-ready',
      visibility: 'PUBLIC',
      publishedAt: '2026-10-01T01:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // When
    const result = await publishRepository('repository-ready');

    // Then
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('repositories/repository-ready/publish'),
      { method: 'POST' },
    );
  });
});
