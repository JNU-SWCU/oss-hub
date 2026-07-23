'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer, useState } from 'react';

import { EmptyState } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

import { createReview, getReviewContext, publishRepository } from '../api';
import { reviewConflictMessage } from '../review-errors';
import {
  INITIAL_REVIEW_FORM_STATE,
  reviewFormError,
  reviewFormReducer,
} from '../review-form';
import type { ReviewContext } from '../types';
import { SubmissionReviewView } from './submission-review-view';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly context: ReviewContext }
  | { readonly kind: 'error'; readonly message: string };

function ReviewSkeleton() {
  return (
    <main
      className="mx-auto grid w-full max-w-5xl gap-6 p-4 sm:p-6 lg:p-8"
      aria-busy="true"
      aria-label="제출 상세를 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted" />
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
    </main>
  );
}

export function SubmissionReviewScreen({
  submissionId,
}: {
  readonly submissionId: string;
}) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [reviewForm, dispatchReviewForm] = useReducer(
    reviewFormReducer,
    INITIAL_REVIEW_FORM_STATE,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      const context = await getReviewContext(submissionId);
      setLoadState({ kind: 'ready', context });
    } catch (error: unknown) {
      setLoadState({
        kind: 'error',
        message:
          error instanceof ApiError
            ? error.problem.detail
            : '제출 검토 정보를 불러오지 못했습니다.',
      });
    }
  }, [submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (loadState.kind !== 'ready') return;
    const validationError = reviewFormError(
      reviewForm.decision,
      reviewForm.comment,
    );
    if (reviewForm.decision === '') {
      setFormError(validationError);
      return;
    }
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      await createReview(submissionId, {
        revision: loadState.context.currentRevision.number,
        decision: reviewForm.decision,
        ...(reviewForm.comment.trim()
          ? { comment: reviewForm.comment.trim() }
          : {}),
      });
      await load();
      setNotice('판정을 저장했습니다.');
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        const conflictMessage = reviewConflictMessage(error);
        if (conflictMessage) {
          dispatchReviewForm({ kind: 'stale-reloaded' });
          await load();
          setFormError(conflictMessage);
        } else {
          setFormError(error.problem.detail);
        }
      } else {
        setFormError('판정을 저장하지 못했습니다.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const publish = async (): Promise<void> => {
    if (loadState.kind !== 'ready' || !loadState.context.repository) return;
    setIsPublishing(true);
    setPublishError(null);
    setNotice(null);
    try {
      await publishRepository(loadState.context.repository.id);
      await load();
      setNotice('GitHub 저장소를 공개 전환했습니다.');
    } catch (error: unknown) {
      setPublishError(
        error instanceof ApiError
          ? error.problem.detail
          : '저장소를 공개 전환하지 못했습니다.',
      );
    } finally {
      setIsPublishing(false);
    }
  };

  if (loadState.kind === 'loading') return <ReviewSkeleton />;
  if (loadState.kind === 'error') {
    return (
      <EmptyState
        title="제출 검토 정보를 불러오지 못했습니다"
        description={loadState.message}
        action={<Button onClick={() => void load()}>다시 시도</Button>}
      />
    );
  }
  return (
    <SubmissionReviewView
      context={loadState.context}
      decision={reviewForm.decision}
      comment={reviewForm.comment}
      isSaving={isSaving}
      isPublishing={isPublishing}
      formError={formError}
      notice={notice}
      publishError={publishError}
      onDecisionChange={(nextDecision) => {
        dispatchReviewForm({
          kind: 'decision-changed',
          decision: nextDecision,
        });
        setFormError(null);
      }}
      onCommentChange={(nextComment: string) => {
        dispatchReviewForm({ kind: 'comment-changed', comment: nextComment });
        setFormError(null);
      }}
      onSave={() => void save()}
      onCancel={() => router.back()}
      onPublish={() => void publish()}
    />
  );
}
