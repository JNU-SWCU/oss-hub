'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { createReview, getReviewContext, publishRepository } from './api';
import { isReviewConflict } from './review-errors';
import { reviewFormError } from './review-form';
import { INITIAL_REVIEW_SESSION, receiveReviewContext } from './review-session';
import type { ReviewDecision } from './types';

const REVIEW_REFRESH_INTERVAL = 30_000;

export function useReviewSession(submissionId: string) {
  const [session, setSession] = useState(INITIAL_REVIEW_SESSION);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const lifetime = useRef(0);
  const request = useRef(0);
  const mutationPending = useRef(false);

  const load = useCallback(async (): Promise<boolean> => {
    const currentRequest = ++request.current;
    const currentLifetime = lifetime.current;
    const isCurrent = () =>
      currentRequest === request.current &&
      currentLifetime === lifetime.current;
    setIsRefreshing(true);
    try {
      const context = await getReviewContext(submissionId);
      if (!isCurrent()) return false;
      setSession((previous) => receiveReviewContext(previous, context));
      setLoadError(null);
      return true;
    } catch (error: unknown) {
      if (!isCurrent()) return false;
      setLoadError(
        error instanceof ApiError
          ? error.problem.detail
          : '제출 검토 정보를 불러오지 못했습니다.',
      );
      return false;
    } finally {
      if (isCurrent()) setIsRefreshing(false);
    }
  }, [submissionId]);

  const refresh = useCallback(() => {
    if (!mutationPending.current) void load();
  }, [load]);

  useEffect(() => {
    refresh();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const interval = window.setInterval(
      refreshVisible,
      REVIEW_REFRESH_INTERVAL,
    );
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      lifetime.current += 1;
      request.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh]);

  const invalidateDecision = (needsLatestRevision: boolean) =>
    setSession((previous) => ({
      ...previous,
      decision: '',
      needsLatestRevision,
    }));

  const save = async (): Promise<void> => {
    if (
      !session.context ||
      mutationPending.current ||
      isRefreshing ||
      session.needsLatestRevision
    )
      return;
    const validationError = reviewFormError(session.decision, session.comment);
    if (session.decision === '' || validationError) {
      setFormError(validationError);
      return;
    }
    const currentLifetime = lifetime.current;
    const isCurrent = () => currentLifetime === lifetime.current;
    mutationPending.current = true;
    request.current += 1;
    setIsSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      await createReview(submissionId, {
        revision: session.context.currentRevision.number,
        decision: session.decision,
        ...(session.comment.trim() ? { comment: session.comment.trim() } : {}),
      });
      if (!isCurrent()) return;
      invalidateDecision(false);
      await load();
      if (!isCurrent()) return;
      setNotice(
        session.decision === 'APPROVED'
          ? '승인을 저장했습니다.'
          : session.decision === 'CHANGES_REQUESTED'
            ? '보완 요청을 저장했습니다.'
            : '반려를 저장했습니다.',
      );
    } catch (error: unknown) {
      if (!isCurrent()) return;
      if (isReviewConflict(error)) {
        invalidateDecision(true);
        const refreshed = await load();
        if (!isCurrent()) return;
        setFormError(
          refreshed
            ? null
            : '제출 상태가 바뀌어 저장하지 못했습니다. 코멘트는 남아 있습니다. 최신 제출본을 다시 확인해 주세요.',
        );
      } else {
        setFormError(
          error instanceof ApiError
            ? error.problem.detail
            : '저장하지 못했습니다. 선택한 결과와 코멘트는 그대로 남아 있으니 다시 저장해 주세요.',
        );
      }
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setIsSaving(false);
      }
    }
  };

  const publish = async (): Promise<void> => {
    if (!session.context?.repository || mutationPending.current) return;
    const currentLifetime = lifetime.current;
    const isCurrent = () => currentLifetime === lifetime.current;
    mutationPending.current = true;
    request.current += 1;
    setIsRefreshing(false);
    setIsPublishing(true);
    setPublishError(null);
    setNotice(null);
    try {
      await publishRepository(session.context.repository.id);
      if (!isCurrent()) return;
      await load();
      if (isCurrent()) setNotice('GitHub 저장소를 공개 전환했습니다.');
    } catch (error: unknown) {
      if (isCurrent())
        setPublishError(
          error instanceof ApiError
            ? error.problem.detail
            : '저장소를 공개로 전환하지 못했습니다. 현재 공개 상태를 확인한 뒤 다시 시도해 주세요.',
        );
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setIsPublishing(false);
      }
    }
  };

  const openLatestRevision = () => {
    if (isRefreshing || loadError || mutationPending.current) return;
    const revision = session.context?.currentRevision.number;
    setSession((previous) =>
      previous.context?.currentRevision.number === revision
        ? { ...previous, needsLatestRevision: false, decision: '' }
        : previous,
    );
    setFormError(null);
  };

  return {
    ...session,
    loadError,
    formError,
    notice,
    publishError,
    isRefreshing,
    isSaving,
    isPublishing,
    refresh,
    openLatestRevision,
    save,
    publish,
    changeDecision: (decision: ReviewDecision) => {
      if (session.needsLatestRevision || isSaving) return;
      setSession((previous) =>
        previous.needsLatestRevision ? previous : { ...previous, decision },
      );
      setFormError(null);
    },
    changeComment: (comment: string) => {
      setSession((previous) => ({ ...previous, comment }));
      setFormError(null);
    },
  };
}
