// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { createReview, getReviewContext } from './api';
import { context, deferred, reviewScreen } from './review-screen-test-support';
import type { ReviewContext, CreateReviewResponse } from './types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('./api', () => ({
  getReviewContext: vi.fn(),
  createReview: vi.fn(),
  publishRepository: vi.fn(),
}));

function staleRevision() {
  return new ApiError({
    type: 'about:blank',
    title: '충돌',
    status: 409,
    detail: '새 제출본',
    instance: '/synthetic',
    code: 'SUB_003',
  });
}

let screen: ReturnType<typeof reviewScreen>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  vi.mocked(getReviewContext).mockReset().mockResolvedValue(context());
  vi.mocked(createReview).mockReset();
  screen = reviewScreen();
});
afterEach(async () => {
  await screen.cleanup();
  vi.unstubAllGlobals();
});

async function enterDraft() {
  await screen.render();
  await act(async () => screen.radio().click());
  await screen.writeComment('작성 중인 검토 의견');
}

async function encounterConflict(number = 2) {
  vi.mocked(createReview).mockRejectedValueOnce(staleRevision());
  vi.mocked(getReviewContext).mockResolvedValue(context(number));
  await act(async () => screen.button('저장').click());
}

describe('review conflict recovery', () => {
  it('opens only the latest submission in one action and preserves the comment for a new verdict', async () => {
    await enterDraft();
    await encounterConflict();
    const target = screen.container.querySelector(
      '[aria-label="검토 대상 제출본"]',
    );
    expect(target?.textContent).not.toContain('제출 글 1');
    expect(target?.textContent).not.toContain('제출 글 2');
    expect(screen.container.textContent).not.toContain('검토를 시작한 제출본');
    expect(screen.container.textContent).not.toContain('30초');
    expect(screen.comment().value).toBe('작성 중인 검토 의견');
    expect(screen.radio().checked).toBe(false);
    expect(screen.radio().disabled).toBe(true);
    expect(screen.button('저장').disabled).toBe(true);
    await act(async () => screen.button('최신 제출본 2번 열기').click());
    expect(target?.textContent).toContain('제출 글 2');
    expect(document.activeElement).toBe(target);
    expect(target?.textContent).not.toContain('제출 글 1');
    expect(screen.container.textContent).not.toContain('확인 완료');
    expect(screen.radio().disabled).toBe(false);
    expect(screen.radio().checked).toBe(false);
    await act(async () => screen.radio('CHANGES_REQUESTED').click());
    vi.mocked(createReview).mockResolvedValueOnce({
      reviewId: 'review-synthetic',
      submissionStatus: 'CHANGES_REQUESTED',
    });
    await act(async () => screen.button('저장').click());
    expect(createReview).toHaveBeenLastCalledWith('submission-synthetic', {
      revision: 2,
      decision: 'CHANGES_REQUESTED',
      comment: '작성 중인 검토 의견',
    });
  });

  it('blocks the previous verdict again when another revision arrives', async () => {
    await enterDraft();
    await encounterConflict();
    await act(async () => screen.button('최신 제출본 2번 열기').click());
    await act(async () => screen.radio().click());
    vi.mocked(getReviewContext).mockResolvedValue(context(3));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.radio().checked).toBe(false);
    expect(screen.radio().disabled).toBe(true);
    const target = screen.container.querySelector(
      '[aria-label="검토 대상 제출본"]',
    );
    expect(target?.textContent).not.toContain('제출 글 1');
    expect(target?.textContent).not.toContain('제출 글 2');
    expect(target?.textContent).not.toContain('제출 글 3');
    expect(screen.comment().value).toBe('작성 중인 검토 의견');
    await act(async () => screen.button('최신 제출본 3번 열기').click());
    expect(target?.textContent).toContain('제출 글 3');
  });

  it.each(['success', 'failure'] as const)(
    'clears all drafts on a different submission and ignores the old save %s',
    async (outcome) => {
      const pending = deferred<CreateReviewResponse>();
      await enterDraft();
      vi.mocked(createReview).mockReturnValueOnce(pending.promise);
      await act(async () => screen.button('저장').click());
      vi.mocked(getReviewContext).mockResolvedValue(
        context(1, 'submission-other'),
      );
      await screen.render('submission-other');
      expect(screen.comment().value).toBe('');
      expect(screen.radio().checked).toBe(false);
      await act(async () => {
        if (outcome === 'success')
          pending.resolve({
            reviewId: 'review-old',
            submissionStatus: 'APPROVED',
          });
        else pending.reject(new Error('old request failed'));
      });
      expect(screen.container.textContent).not.toContain(
        '승인을 저장했습니다.',
      );
      expect(screen.container.textContent).not.toContain(
        '저장하지 못했습니다.',
      );
      expect(getReviewContext).toHaveBeenLastCalledWith('submission-other');
    },
  );

  it('ignores an old route query that arrives after the new route query', async () => {
    const pending = deferred<ReviewContext>();
    vi.mocked(getReviewContext).mockReturnValueOnce(pending.promise);
    await screen.render();
    vi.mocked(getReviewContext).mockResolvedValue(
      context(3, 'submission-other'),
    );
    await screen.render('submission-other');
    await act(async () => pending.resolve(context()));
    expect(screen.container.textContent).toContain('제출 글 3');
    expect(screen.container.textContent).not.toContain('제출 글 1');
  });
});
