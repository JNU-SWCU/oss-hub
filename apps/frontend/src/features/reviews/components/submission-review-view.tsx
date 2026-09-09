import { PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { applicationModeLabel } from '../review-format';
import type { ReviewDecisionInput } from '../review-form';
import type { ReviewContext, ReviewDecision } from '../types';
import { RepositoryPublishCard } from './repository-publish-card';
import { RevisionCard } from './revision-history';
import { ReviewForm } from './review-form';
import { ReviewSubmission } from './review-submission';

/** submission-review-screen과 같은 폭을 쓴다. */
const REVIEW_WIDTH = 'max-w-5xl';

export interface SubmissionReviewViewProps {
  readonly context: ReviewContext;
  readonly needsLatestRevision?: boolean;
  readonly isRefreshing?: boolean;
  readonly refreshError?: string | null;
  readonly onOpenLatestRevision?: () => void;
  readonly onRefresh?: () => void;
  readonly decision: ReviewDecisionInput;
  readonly comment: string;
  readonly isSaving: boolean;
  readonly isPublishing: boolean;
  readonly formError: string | null;
  readonly notice: string | null;
  readonly publishError: string | null;
  readonly onDecisionChange: (decision: ReviewDecision) => void;
  readonly onCommentChange: (comment: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onPublish: () => void;
}

/**
 * 이력이 비어 있는 것과 실제로 첫 제출인 것은 다르다. 회차 값이 근거이고,
 * 이력 유무는 근거가 아니다. 2회차 이상인데 이력이 비면 조회가 실패했거나
 * 잘린 것이므로 최초 제출로 안내하면 교직원이 재제출본을 오인한다.
 */
function EmptyHistoryNotice({
  currentNumber,
}: {
  readonly currentNumber: number;
}) {
  return (
    <p className="rounded-card border border-border p-card text-small text-muted-foreground [word-break:keep-all]">
      {currentNumber > 1
        ? `현재는 ${currentNumber}번째 제출본이지만 이전 이력을 확인할 수 없습니다. 새로고침 후에도 비어 있으면 담당자에게 알려 주세요.`
        : '첫 제출입니다.'}
    </p>
  );
}

export function SubmissionReviewView(props: SubmissionReviewViewProps) {
  const reviewContext = props.context;
  return (
    <PageBody className={REVIEW_WIDTH}>
      <PageHeader
        title="최종 제출 검토"
        description={`${reviewContext.application.displayName}, ${applicationModeLabel(reviewContext.application.applicationMode)}, ${reviewContext.milestone.name}`}
      />
      {/* 섹션 사이 64 — 검토 대상 / 판정 / 이력 / 공개 전환 */}
      <div className="flex min-w-0 flex-col gap-16">
        {props.notice ? (
          <Alert>
            <AlertDescription>{props.notice}</AlertDescription>
          </Alert>
        ) : null}
        <ReviewSubmission
          context={reviewContext}
          needsLatestRevision={props.needsLatestRevision ?? false}
          isRefreshing={props.isRefreshing ?? false}
          disabled={props.isSaving || props.isPublishing}
          refreshError={props.refreshError ?? null}
          onRefresh={props.onRefresh}
          onOpenLatestRevision={props.onOpenLatestRevision}
        />
        {reviewContext.currentRevision.review ? null : (
          <ReviewForm {...props} />
        )}
        <section
          className="grid gap-4"
          aria-labelledby="revision-history-title"
        >
          <h2
            id="revision-history-title"
            className="font-heading text-section font-semibold tracking-[-0.02em]"
          >
            이전 제출본과 검토 이력
          </h2>
          {reviewContext.history.length > 0 ? (
            reviewContext.history.map((revision) => (
              <RevisionCard key={revision.number} revision={revision} />
            ))
          ) : (
            <EmptyHistoryNotice
              currentNumber={reviewContext.currentRevision.number}
            />
          )}
        </section>
        <RepositoryPublishCard
          repository={reviewContext.repository}
          isPublishing={props.isPublishing}
          errorMessage={props.publishError}
          onPublish={props.onPublish}
        />
      </div>
    </PageBody>
  );
}
