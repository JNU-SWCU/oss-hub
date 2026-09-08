// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { getReviewContext, createReview } from './api';
import { context, deferred, reviewScreen } from './review-screen-test-support';
import type { CreateReviewResponse, ReviewContext } from './types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('./api', () => ({
  getReviewContext: vi.fn(),
  createReview: vi.fn(),
  publishRepository: vi.fn(),
}));
let screen: ReturnType<typeof reviewScreen>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(getReviewContext).mockReset().mockResolvedValue(context());
  vi.mocked(createReview).mockReset();
  screen = reviewScreen();
});
afterEach(async () => {
  await screen.cleanup();
  vi.unstubAllGlobals();
});

describe('review request ordering', () => {
  it('does not restore an older server revision from the newest request', async () => {
    await screen.render();
    vi.mocked(getReviewContext).mockResolvedValue(context(3));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => screen.button('최신 제출본 3번 열기').click());
    await act(async () => screen.radio().click());
    vi.mocked(getReviewContext).mockResolvedValue(context(2));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.container.textContent).toContain('제출 글 3');
    expect(screen.container.textContent).not.toContain('제출 글 2');
    expect(screen.radio().checked).toBe(true);
    expect(screen.radio().disabled).toBe(false);
  });
  it('does not start a duplicate save or a focus refresh while saving', async () => {
    await screen.render();
    await act(async () => screen.radio().click());
    const pending = deferred<CreateReviewResponse>();
    vi.mocked(createReview).mockReturnValueOnce(pending.promise);
    await act(async () => {
      screen.button('저장').click();
      screen.button('저장').click();
      window.dispatchEvent(new Event('focus'));
    });
    expect(createReview).toHaveBeenCalledTimes(1);
    expect(getReviewContext).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error('network down')));
    expect(screen.radio().checked).toBe(true);
    expect(screen.button('저장').disabled).toBe(false);
  });
  it('keeps the opened submission and verdict on refresh of the same revision', async () => {
    await screen.render();
    vi.mocked(getReviewContext).mockResolvedValue(context(2));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => screen.button('최신 제출본 2번 열기').click());
    await act(async () => screen.radio().click());
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.radio().checked).toBe(true);
    expect(screen.radio().disabled).toBe(false);
    expect(screen.container.textContent).toContain('제출 글 2');
    expect(screen.container.textContent).not.toContain('최신 제출본 2번 열기');
  });
  it('ignores an earlier failed refresh after the latest refresh succeeds', async () => {
    await screen.render();
    const earlier = deferred<ReviewContext>();
    vi.mocked(getReviewContext)
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce(context(2));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => earlier.reject(new Error('old request failed')));
    expect(screen.button('최신 제출본 2번 열기')).toBeDefined();
    expect(screen.container.textContent).not.toContain(
      '제출 검토 정보를 불러오지 못했습니다.',
    );
  });
  it('shows the current result when another reviewer already completed the review', async () => {
    await screen.render();
    await act(async () => screen.radio().click());
    vi.mocked(createReview).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: '충돌',
        status: 409,
        detail: '이미 검토됨',
        instance: '/synthetic',
        code: 'SUB_004',
      }),
    );
    const reviewed = context();
    vi.mocked(getReviewContext).mockResolvedValue({
      ...reviewed,
      currentRevision: {
        ...reviewed.currentRevision,
        review: {
          id: 'review-completed',
          decision: 'CHANGES_REQUESTED',
          comment: '확인할 내용을 추가해 주세요.',
          reviewedAt: '2026-09-02T01:00:00.000Z',
        },
      },
    });
    await act(async () => screen.button('저장').click());
    expect(screen.container.querySelector('textarea')).toBeNull();
    expect(screen.container.textContent).toContain(
      '확인할 내용을 추가해 주세요.',
    );
    expect(createReview).toHaveBeenCalledTimes(1);
  });
});
