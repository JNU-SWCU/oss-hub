// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReviewContext, createReview } from './api';
import { context, deferred, reviewScreen } from './review-screen-test-support';
import type { ReviewContext } from './types';

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('review background refresh', () => {
  it('keeps the input element, focus, selection, and comment during a refresh and failure', async () => {
    await screen.render();
    await screen.writeComment('선택 위치를 유지할 의견');
    const comment = screen.comment();
    comment.focus();
    comment.setSelectionRange(3, 5);
    const pending = deferred<ReviewContext>();
    vi.mocked(getReviewContext).mockReturnValueOnce(pending.promise);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.comment()).toBe(comment);
    expect(document.activeElement).toBe(comment);
    expect(comment.selectionStart).toBe(3);
    expect(comment.selectionEnd).toBe(5);
    await act(async () => pending.reject(new Error('network down')));
    expect(screen.comment()).toBe(comment);
    expect(comment.value).toBe('선택 위치를 유지할 의견');
    expect(screen.container.textContent).toContain(
      '최신 제출본 확인을 다시 시도해 주세요.',
    );
  });

  it('ignores an earlier refresh arriving after a later revision response', async () => {
    await screen.render();
    const earlier = deferred<ReviewContext>();
    const later = deferred<ReviewContext>();
    vi.mocked(getReviewContext)
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(later.promise);
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => later.resolve(context(3)));
    await act(async () => earlier.resolve(context(2)));
    expect(screen.container.textContent).toContain('제출 글 1');
    expect(screen.container.textContent).toContain('제출 글 3');
    expect(screen.container.textContent).not.toContain('제출 글 2');
    expect(screen.radio().disabled).toBe(true);
  });

  it('checks every 30 seconds only while visible and removes timers and listeners on unmount', async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('visible');
    await screen.render();
    expect(getReviewContext).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(29_999));
    expect(getReviewContext).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(getReviewContext).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('hidden');
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(getReviewContext).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    await act(async () =>
      document.dispatchEvent(new Event('visibilitychange')),
    );
    expect(getReviewContext).toHaveBeenCalledTimes(3);
    await screen.cleanup();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(getReviewContext).toHaveBeenCalledTimes(3);
    screen = reviewScreen();
  });

  it('retains the conflict gate and comment if reloading after conflict fails', async () => {
    const { ApiError } = await import('@/lib/api-client');
    await screen.render();
    await act(async () => screen.radio().click());
    await screen.writeComment('유지할 검토 의견');
    vi.mocked(createReview).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: '충돌',
        status: 409,
        detail: '새 제출본',
        instance: '/synthetic',
        code: 'SUB_003',
      }),
    );
    vi.mocked(getReviewContext).mockRejectedValueOnce(
      new Error('network down'),
    );
    await act(async () => screen.button('저장').click());
    expect(screen.comment().value).toBe('유지할 검토 의견');
    expect(screen.radio().disabled).toBe(true);
    expect(screen.button('저장').disabled).toBe(true);
    expect(screen.container.textContent).not.toContain(
      '새 제출본을 올려 최신 내용을 다시 불러왔습니다',
    );
    vi.mocked(getReviewContext).mockResolvedValue(context(2));
    await act(async () => screen.button('최신 제출본 확인').click());
    expect(screen.button('제출본 2번 확인 완료')).toBeDefined();
  });
});
