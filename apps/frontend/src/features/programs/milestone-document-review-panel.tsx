import { Download } from 'lucide-react';
import type { ReactElement } from 'react';
import { StatusBadge } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import type { MilestoneDocumentCollectionCell } from './milestone-document-collection-api';
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

/**
 * 수합 표의 칸을 눌렀을 때 **그 자리에서** 열리는 판정 패널.
 *
 * 다른 화면으로 넘기지 않는 것이 이 화면의 요구다 — 교직원은 여러 건을 연달아 처리하는데,
 * 표를 떠나면 어디까지 봤는지 잃는다. 그래서 이 컴포넌트는 표 안(행 아래)에 그려지고,
 * 조회·전송은 전부 컨테이너(`milestone-document-collection-screen.tsx`)가 갖는다.
 * 여기는 props만 그린다 — 정적 렌더로 문구를 검증할 수 있게 하려는 분리다.
 */

const DECISION_BUTTON_BASE =
  'h-control rounded-control px-4 text-small font-semibold transition-colors';

export interface MilestoneDocumentReviewPanelProps {
  readonly teamName: string;
  readonly documentName: string;
  readonly cell: MilestoneDocumentCollectionCell;
  /** 첨부가 살아 있을 때만 채운다 — 경로 조립은 collection-api가 소유한다. */
  readonly fileHref: string | null;
  readonly decision: MilestoneDocumentReviewDecision | null;
  readonly comment: string;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly onDecisionChange: (
    decision: MilestoneDocumentReviewDecision,
  ) => void;
  readonly onCommentChange: (comment: string) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}

/**
 * 지난 판정. 판정은 덮어쓰지 않고 쌓이므로, 교직원이 바뀌어도 앞사람이 무엇을 지적했는지
 * 보이는 것이 이 기능의 요구다.
 *
 * ⚠ 응답이 주는 것은 **최신 한 건**뿐이다(`cells[].review`). 이력 전체를 주는 조회는 없다 —
 * 「지난 판정 목록」을 그리고 싶어도 여기서 지어낼 수 없으니 만들지 마라.
 */
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
        지난 판정
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
        {review.comment ?? '사유 없이 저장된 판정입니다.'}
      </p>
      <p className="text-small text-muted-foreground break-keep">
        판정은 덮어쓰지 않고 쌓입니다. 새로 저장해도 이 기록은 남습니다.
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

  return (
    <div
      data-testid="milestone-document-review-panel"
      className="grid gap-4 rounded-card border border-border p-card text-left"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-semibold break-keep">
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

      {cell.review === null ? null : <PreviousReview review={cell.review} />}

      <div
        role="group"
        aria-label="판정"
        className="flex flex-wrap items-center gap-2"
      >
        {MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={props.decision === option}
            disabled={props.isSubmitting}
            className={
              props.decision === option
                ? `${DECISION_BUTTON_BASE} bg-secondary text-foreground`
                : `${DECISION_BUTTON_BASE} bg-card text-muted-foreground border border-border`
            }
            onClick={() => props.onDecisionChange(option)}
          >
            {MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS[option]}
          </button>
        ))}
      </div>

      <Field>
        <FieldLabel htmlFor={commentId}>사유</FieldLabel>
        <textarea
          id={commentId}
          value={props.comment}
          maxLength={MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH}
          disabled={props.isSubmitting}
          aria-describedby={`${commentId}-description`}
          onChange={(event) => props.onCommentChange(event.target.value)}
          className="min-h-28 w-full resize-y rounded-lg border border-input bg-transparent p-3 text-sm leading-6 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <FieldDescription id={`${commentId}-description`}>
          학생에게 그대로 보입니다 · 최대 2,000자
        </FieldDescription>
      </Field>

      {/*
       * 사유가 언제 필요한지 **누르기 전에** 말한다. 이 문구가 없으면 교직원은 반려를
       * 고르고 저장을 눌러 본 뒤에야 막힌 이유를 알게 되고, 그 사이 적어 둔 것도 없다.
       */}
      <p className="text-small text-muted-foreground break-keep">
        보완 요청·반려는 사유를 적어야 저장됩니다. 승인은 안 적어도 됩니다.
      </p>

      {props.errorMessage === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{props.errorMessage}</AlertDescription>
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
          {props.isSubmitting ? '저장 중…' : '판정 저장'}
        </Button>
      </div>
    </div>
  );
}
