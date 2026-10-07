import { Download } from 'lucide-react';
import type { ReactElement } from 'react';
import { FilterChip, FilterChipGroup, StatusBadge } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionContent,
  MilestoneDocumentCollectionHistory,
} from './milestone-document-collection-api';
import { MilestoneDocumentHistoryTimeline } from './milestone-document-history-timeline';
import {
  formatSeoulDate,
  formatSeoulShortDateTime,
} from './program-detail-format';
import {
  MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
  milestoneDocumentCellDisplay,
} from './milestone-document-review';
import {
  MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH,
  type MilestoneDocumentReviewDecision,
} from './milestone-document-review-api';

const CONTENT_HEADING = 'text-small font-semibold';

export interface MilestoneDocumentReviewPanelProps {
  readonly teamName: string;
  readonly documentName: string;
  readonly cell: MilestoneDocumentCollectionCell;

  readonly fileHref: string | null;
  readonly decision: MilestoneDocumentReviewDecision | null;
  readonly comment: string;

  readonly resubmissionDueAt: string;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly onDecisionChange: (
    decision: MilestoneDocumentReviewDecision,
  ) => void;
  readonly onCommentChange: (comment: string) => void;
  readonly onResubmissionDueAtChange: (resubmissionDueAt: string) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly history: readonly MilestoneDocumentCollectionHistory[];
  readonly isHistoryLoading: boolean;
  readonly historyError: string | null;
  readonly hasMoreHistory: boolean;
  readonly historyIsComplete: boolean;
  readonly onHistoryMore: () => void;
}

function SubmittedText({ text }: { readonly text: string }): ReactElement {
  return (
    <div className="grid gap-1">
      <h4 className={CONTENT_HEADING}>제출한 글</h4>
      <div
        data-testid="milestone-document-submitted-text"
        tabIndex={0}
        role="region"
        aria-label="제출한 글"
        className={cn(
          'max-h-80 overflow-y-auto rounded-card border border-border bg-card p-card',
          'text-small leading-6 break-words whitespace-pre-wrap outline-none',
          'focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
      >
        {text}
      </div>
    </div>
  );
}

function NothingToShow(): ReactElement {
  return (
    <Alert data-testid="milestone-document-no-content">
      <AlertDescription className="break-keep">
        제출은 있지만 보여 줄 파일도 내용도 없습니다. 첨부의 보존 기한이
        지났거나 제출 내용을 읽지 못한 경우입니다. 내용을 확인하지 않은 채
        승인하지 말고, 학생에게 다시 받아 주세요.
      </AlertDescription>
    </Alert>
  );
}

function SubmittedContent({
  cell,
  fileHref,
}: {
  readonly cell: MilestoneDocumentCollectionCell;
  readonly fileHref: string | null;
}): ReactElement | null {
  if (!cell.isSubmitted) return null;
  const content: MilestoneDocumentCollectionContent | null = cell.content;

  const hasFile = cell.file !== null && fileHref !== null;

  if (content !== null) {
    return <SubmittedText text={content.text} />;
  }
  if (hasFile) return null;
  return <NothingToShow />;
}

function PreviousReview({
  review,
}: {
  readonly review: NonNullable<MilestoneDocumentCollectionCell['review']>;
}): ReactElement {
  return (
    <div
      data-testid="milestone-document-previous-review"
      className="grid gap-1 rounded-card border border-border bg-card p-card"
    >
      <p className="flex flex-wrap items-center gap-2 text-small font-semibold">
        지난 검토
        <StatusBadge
          variant={MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS[review.decision]}
        >
          {MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS[review.decision]}
        </StatusBadge>
        <span className="font-normal text-muted-foreground">
          {formatSeoulDate(review.reviewedAt)}
        </span>
      </p>
      <p className="text-small break-keep whitespace-pre-wrap">
        {review.comment ?? '사유 없이 저장되었습니다.'}
      </p>

      {review.decision !== 'CHANGES_REQUESTED' ? null : (
        <p
          data-testid="milestone-document-previous-review-due-at"
          className="text-small text-muted-foreground break-keep"
        >
          재제출 기한{' '}
          {review.resubmissionDueAt === null
            ? '없음 (이 기능이 생기기 전에 저장된 보완 요청입니다)'
            : `${formatSeoulDate(review.resubmissionDueAt)}까지`}
        </p>
      )}
      <p className="text-small text-muted-foreground break-keep">
        새 검토를 저장해도 이전 검토 기록은 남습니다.
      </p>
    </div>
  );
}

export function MilestoneDocumentReviewPanel(
  props: MilestoneDocumentReviewPanelProps,
): ReactElement {
  const { cell } = props;
  const display = milestoneDocumentCellDisplay(cell);
  const commentId = 'milestone-document-review-comment';
  const resubmissionDueAtId = 'milestone-document-review-resubmission-due-at';

  return (
    <div
      data-testid="milestone-document-review-panel"
      className="grid gap-4 whitespace-normal rounded-card border border-border p-card text-left"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-keep [overflow-wrap:anywhere] text-body font-semibold">
          {props.teamName} — {props.documentName}
        </h3>
        <StatusBadge
          variant={MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS[display]}
        >
          {MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS[display]}
        </StatusBadge>
        {cell.submittedAt === null ? null : (
          <span className="text-small text-muted-foreground">
            {formatSeoulShortDateTime(cell.submittedAt)} 제출
          </span>
        )}
      </div>

      {cell.file === null || props.fileHref === null ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <span
            title={cell.file.name}
            className="min-w-0 max-w-72 truncate text-small"
          >
            {cell.file.name}
          </span>
          <Button asChild size="sm" variant="outline">
            <a href={props.fileHref}>
              <Download aria-hidden /> 내려받기
            </a>
          </Button>
        </div>
      )}

      <SubmittedContent cell={cell} fileHref={props.fileHref} />

      {props.isHistoryLoading && props.history.length === 0 ? (
        <p className="text-small text-muted-foreground">
          이력을 불러오는 중입니다.
        </p>
      ) : (
        <MilestoneDocumentHistoryTimeline
          history={props.history ?? []}
          completeness={
            !props.historyIsComplete
              ? 'incomplete'
              : props.hasMoreHistory
                ? 'has-more'
                : 'complete'
          }
        />
      )}

      {props.historyError === null ? null : (
        <Alert variant="destructive">
          <AlertDescription className="break-keep [overflow-wrap:anywhere]">
            {props.historyError}
          </AlertDescription>
        </Alert>
      )}

      {props.historyError !== null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.isHistoryLoading}
          onClick={props.onHistoryMore}
        >
          {props.isHistoryLoading
            ? '제출 이력을 불러오는 중…'
            : '제출 이력 다시 불러오기'}
        </Button>
      ) : props.hasMoreHistory ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.isHistoryLoading}
          onClick={props.onHistoryMore}
        >
          {props.isHistoryLoading ? '이력을 불러오는 중…' : '이전 이력 더 보기'}
        </Button>
      ) : null}

      {props.history.length > 0 || cell.review === null ? null : (
        <PreviousReview review={cell.review} />
      )}

      <FilterChipGroup aria-label="검토" className="items-center">
        {MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER.map((option) => (
          <FilterChip
            key={option}
            pressed={props.decision === option}
            disabled={props.isSubmitting}
            onClick={() => props.onDecisionChange(option)}
          >
            {MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS[option]}
          </FilterChip>
        ))}
      </FilterChipGroup>

      <Field>
        <FieldLabel htmlFor={commentId}>사유</FieldLabel>
        <textarea
          id={commentId}
          value={props.comment}
          maxLength={MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH}
          disabled={props.isSubmitting}
          aria-describedby={`${commentId}-description`}
          onChange={(event) => props.onCommentChange(event.target.value)}
          className={cn(
            'min-h-28 w-full resize-y rounded-lg border border-input bg-transparent p-3',
            'text-sm leading-6 transition-colors outline-none',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <FieldDescription id={`${commentId}-description`}>
          학생에게 그대로 보입니다 · 최대 2,000자
        </FieldDescription>
      </Field>

      {props.decision === 'CHANGES_REQUESTED' ? (
        <Field>
          <FieldLabel htmlFor={resubmissionDueAtId}>재제출 기한</FieldLabel>
          <Input
            id={resubmissionDueAtId}
            type="datetime-local"
            value={props.resubmissionDueAt}
            disabled={props.isSubmitting}
            aria-describedby={`${resubmissionDueAtId}-description`}
            onChange={(event) =>
              props.onResubmissionDueAtChange(event.target.value)
            }
          />
          <FieldDescription id={`${resubmissionDueAtId}-description`}>
            학생은 이 시각까지 한 번 다시 낼 수 있습니다 · 마감이 지난
            마일스톤이라도 이 기한 안에는 열립니다
          </FieldDescription>
        </Field>
      ) : null}

      <p className="text-small text-muted-foreground break-keep">
        보완 요청·반려는 사유를 적어야 저장됩니다. 승인은 안 적어도 됩니다. 보완
        요청은 재제출 기한도 함께 정해야 합니다.
      </p>

      {props.errorMessage === null ? null : (
        <Alert variant="destructive">
          <AlertDescription className="break-keep [overflow-wrap:anywhere]">
            {props.errorMessage}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={props.isSubmitting}
          onClick={props.onClose}
        >
          닫기
        </Button>
        <Button
          type="button"
          disabled={props.isSubmitting}
          onClick={props.onSubmit}
        >
          {props.isSubmitting ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}
