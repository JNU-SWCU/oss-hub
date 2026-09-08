'use client';

import { useRouter } from 'next/navigation';

import { EmptyState, PageBody } from '@/components';
import { Button } from '@/components/ui/button';

import { useReviewSession } from '../use-review-session';
import { SubmissionReviewView } from './submission-review-view';

/** 검토는 읽고 판단하는 화면이라 폭을 5xl로 둔다 — 나머지 여백은 PageBody가 갖는다. */
const REVIEW_WIDTH = 'max-w-5xl';

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
  return <ReviewSessionScreen key={submissionId} submissionId={submissionId} />;
}

function ReviewSessionScreen({
  submissionId,
}: {
  readonly submissionId: string;
}) {
  const router = useRouter();
  const review = useReviewSession(submissionId);
  if (!review.context) {
    if (!review.loadError) return <ReviewSkeleton />;
    return (
      <EmptyState
        title="제출 검토 정보를 불러오지 못했습니다"
        description={review.loadError}
        action={<Button onClick={review.refresh}>다시 시도</Button>}
      />
    );
  }
  return (
    <SubmissionReviewView
      context={review.context}
      decision={review.decision}
      comment={review.comment}
      isSaving={review.isSaving}
      isPublishing={review.isPublishing}
      isRefreshing={review.isRefreshing}
      needsLatestRevision={review.needsLatestRevision}
      refreshError={review.loadError}
      formError={review.formError}
      notice={review.notice}
      publishError={review.publishError}
      onDecisionChange={review.changeDecision}
      onCommentChange={review.changeComment}
      onOpenLatestRevision={review.openLatestRevision}
      onRefresh={review.refresh}
      onSave={() => void review.save()}
      onCancel={() => router.back()}
      onPublish={() => void review.publish()}
    />
  );
}
