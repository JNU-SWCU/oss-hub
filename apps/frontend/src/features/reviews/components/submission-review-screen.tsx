'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, PageBody } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

import { createReview, getReviewContext, publishRepository } from '../api';
import { reviewConflictMessage } from '../review-errors';
import { reviewFormError, type ReviewDecisionInput } from '../review-form';
import type { ReviewContext, ReviewDecision } from '../types';
import { SubmissionReviewView } from './submission-review-view';

/** 검토는 읽고 판단하는 화면이라 폭을 5xl로 둔다 — 나머지 여백은 PageBody가 갖는다. */
const REVIEW_WIDTH = 'max-w-5xl';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly context: ReviewContext }
  | { readonly kind: 'error'; readonly message: string };

function ReviewSkeleton() {
  return (
    <PageBody
      className={REVIEW_WIDTH}
      aria-busy="true"
      aria-label="제출 상세를 불러오는 중"
    >
      <div className="mb-12 h-20 animate-pulse rounded-card bg-muted" />
      <div className="flex flex-col gap-8">
        <div className="h-72 animate-pulse rounded-card bg-muted" />
        <div className="h-64 animate-pulse rounded-card bg-muted" />
      </div>
    </PageBody>
  );
}

export function SubmissionReviewScreen({
  submissionId,
}: {
  readonly submissionId: string;
}) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [decision, setDecision] = useState<ReviewDecisionInput>('');
  const [comment, setComment] = useState('');
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
    const validationError = reviewFormError(decision, comment);
    if (decision === '') {
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
        decision,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      await load();
      setNotice(
        decision === 'APPROVED'
          ? '승인을 저장했습니다.'
          : decision === 'CHANGES_REQUESTED'
            ? '보완 요청을 저장했습니다.'
            : '반려를 저장했습니다.',
      );
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        const conflictMessage = reviewConflictMessage(error);
        if (conflictMessage) {
          await load();
          setFormError(conflictMessage);
        } else {
          setFormError(error.problem.detail);
        }
      } else {
        // decision·comment state를 건드리지 않으므로 "유지했다"는 안내가 사실이다.
        setFormError(
          '저장하지 못했습니다. 선택한 결과와 코멘트는 그대로 남아 있으니 다시 저장해 주세요.',
        );
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
          : '저장소를 공개로 전환하지 못했습니다. 현재 공개 상태를 확인한 뒤 다시 시도해 주세요.',
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
      decision={decision}
      comment={comment}
      isSaving={isSaving}
      isPublishing={isPublishing}
      formError={formError}
      notice={notice}
      publishError={publishError}
      onDecisionChange={(nextDecision: ReviewDecision) => {
        setDecision(nextDecision);
        setFormError(null);
      }}
      onCommentChange={(nextComment: string) => {
        setComment(nextComment);
        setFormError(null);
      }}
      onSave={() => void save()}
      onCancel={() => router.back()}
      onPublish={() => void publish()}
    />
  );
}
