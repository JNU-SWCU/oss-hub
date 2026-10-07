import type {
  MilestoneDocumentSubmissionStatus,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-api';
import type {
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionHistory,
} from './milestone-document-collection-api';
import {
  MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH,
  type MilestoneDocumentReviewDecision,
} from './milestone-document-review-api';
import {
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
} from '@/lib/status-vocabulary';
import { isPastDue } from './program-detail-format';
import { seoulDateTimeValue } from './seoul-date-time';

export type MilestoneDocumentReviewDisplay =
  'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export const MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS = {
  NOT_SUBMITTED: SUBMISSION_STATUS_LABELS.NOT_SUBMITTED,
  PENDING: SUBMISSION_STATUS_LABELS.SUBMITTED,
  APPROVED: SUBMISSION_STATUS_LABELS.APPROVED,
  CHANGES_REQUESTED: SUBMISSION_STATUS_LABELS.CHANGES_REQUESTED,
  REJECTED: SUBMISSION_STATUS_LABELS.REJECTED,
} as const satisfies Readonly<Record<MilestoneDocumentReviewDisplay, string>>;

export const MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS = {
  NOT_SUBMITTED: SUBMISSION_STATUS_BADGE.NOT_SUBMITTED,
  PENDING: SUBMISSION_STATUS_BADGE.SUBMITTED,
  APPROVED: SUBMISSION_STATUS_BADGE.APPROVED,
  CHANGES_REQUESTED: SUBMISSION_STATUS_BADGE.CHANGES_REQUESTED,
  REJECTED: SUBMISSION_STATUS_BADGE.REJECTED,
} as const satisfies Readonly<
  Record<
    MilestoneDocumentReviewDisplay,
    'closed' | 'recruiting' | 'approved' | 'pending' | 'rejected'
  >
>;

export const MILESTONE_DOCUMENT_REVIEW_DECISION_ORDER: readonly MilestoneDocumentReviewDecision[] =
  ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'];

function submittedDisplay(
  status: MilestoneDocumentSubmissionStatus | null,
): MilestoneDocumentReviewDisplay {
  return status === null || status === 'SUBMITTED' ? 'PENDING' : status;
}

export function milestoneDocumentCellDisplay(
  cell: Pick<MilestoneDocumentCollectionCell, 'isSubmitted' | 'status'>,
): MilestoneDocumentReviewDisplay {
  if (!cell.isSubmitted) return 'NOT_SUBMITTED';
  return submittedDisplay(cell.status);
}

export function milestoneDocumentViewerDisplay(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): MilestoneDocumentReviewDisplay {
  if (viewerSubmission === undefined || !viewerSubmission.submitted) {
    return 'NOT_SUBMITTED';
  }
  return submittedDisplay(viewerSubmission.status);
}

export function isMilestoneDocumentResubmittable(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): boolean {
  const status = viewerSubmission?.status ?? null;
  if (status === null) return true;
  switch (status) {
    case 'APPROVED':
    case 'REJECTED':
      return false;
    case 'SUBMITTED':
    case 'CHANGES_REQUESTED':
      return true;
  }
}

export function isMilestoneDocumentDeadlineLocked(
  closed: boolean,
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
  now: number = Date.now(),
): boolean {
  if (!closed) return false;
  if (viewerSubmission?.status !== 'CHANGES_REQUESTED') return true;
  return isMilestoneDocumentResubmissionDueAtPassed(viewerSubmission, now);
}

export function isMilestoneDocumentResubmissionDueAtPassed(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
  now: number = Date.now(),
): boolean {
  const dueAt = viewerSubmission?.review?.resubmissionDueAt ?? null;
  if (dueAt === null) return false;
  return isPastDue(dueAt, now);
}

export function isMilestoneDocumentResubmissionFinal(
  closed: boolean,
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): boolean {
  return closed && viewerSubmission?.status === 'CHANGES_REQUESTED';
}

export function milestoneDocumentResubmissionDueNotice(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
  now: number = Date.now(),
): { readonly kind: 'open' | 'passed'; readonly dueAt: string } | null {
  if (viewerSubmission?.status !== 'CHANGES_REQUESTED') return null;
  const dueAt = viewerSubmission.review?.resubmissionDueAt ?? null;
  if (dueAt === null) return null;
  return {
    kind: isMilestoneDocumentResubmissionDueAtPassed(viewerSubmission, now)
      ? 'passed'
      : 'open',
    dueAt,
  };
}

const MAX_TIMEOUT_DELAY = 2_147_483_647;

export function milestoneDocumentResubmissionDueTickDelay(
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
  now: number = Date.now(),
): number | null {
  const notice = milestoneDocumentResubmissionDueNotice(viewerSubmission, now);
  if (notice === null || notice.kind !== 'open') return null;
  const dueAt = new Date(notice.dueAt).getTime();
  if (!Number.isFinite(dueAt)) return null;

  return Math.min(Math.max(dueAt - now + 1, 0), MAX_TIMEOUT_DELAY);
}

export function shouldHighlightMilestoneDocumentReview(
  display: MilestoneDocumentReviewDisplay,
): boolean {
  return display === 'CHANGES_REQUESTED' || display === 'REJECTED';
}

export type MilestoneDocumentReviewNoticeTone = 'warning' | 'neutral';

export function milestoneDocumentReviewNoticeTone(
  display: MilestoneDocumentReviewDisplay,
  comment: string | null,
): MilestoneDocumentReviewNoticeTone | null {
  if (shouldHighlightMilestoneDocumentReview(display)) return 'warning';
  if (display !== 'APPROVED') return null;

  return comment !== null && comment.trim() !== '' ? 'neutral' : null;
}

export function isMilestoneDocumentReviewCommentRequired(
  decision: MilestoneDocumentReviewDecision,
): boolean {
  return decision === 'CHANGES_REQUESTED' || decision === 'REJECTED';
}

export function milestoneDocumentReviewFormError(
  decision: MilestoneDocumentReviewDecision | null,
  comment: string,
  resubmissionDueAt = '',
  now: number = Date.now(),
): string | null {
  if (decision === null) return '승인, 보완 요청, 반려 중 하나를 골라 주세요.';
  if (
    isMilestoneDocumentReviewCommentRequired(decision) &&
    comment.trim() === ''
  ) {
    return '보완 요청과 반려는 사유를 입력해 주세요.';
  }
  if (comment.length > MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH) {
    return `사유는 ${MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH.toLocaleString('ko-KR')}자까지 쓸 수 있습니다.`;
  }
  return milestoneDocumentResubmissionDueAtError(
    decision,
    resubmissionDueAt,
    now,
  );
}

export function milestoneDocumentResubmissionDueAtError(
  decision: MilestoneDocumentReviewDecision,
  resubmissionDueAt: string,
  now: number = Date.now(),
): string | null {
  if (decision !== 'CHANGES_REQUESTED') return null;
  if (resubmissionDueAt.trim() === '') {
    return '보완 요청은 재제출 기한을 정해 주세요.';
  }
  const parsed = seoulDateTimeValue(resubmissionDueAt);
  if (parsed === null) {
    return '재제출 기한을 다시 골라 주세요.';
  }
  if (parsed <= now) {
    return '재제출 기한은 지금보다 뒤여야 합니다.';
  }
  return null;
}

export function milestoneDocumentResubmissionDueAtPayload(
  decision: MilestoneDocumentReviewDecision,
  resubmissionDueAt: string,
): string | undefined {
  if (decision !== 'CHANGES_REQUESTED') return undefined;
  const parsed = seoulDateTimeValue(resubmissionDueAt);
  return parsed === null ? undefined : new Date(parsed).toISOString();
}

export function milestoneDocumentReviewCommentPayload(
  comment: string,
): string | undefined {
  const trimmed = comment.trim();
  return trimmed === '' ? undefined : trimmed;
}

export interface MilestoneDocumentReviewTarget {
  readonly applicationId: string;
  readonly documentId: string;
}

export interface MilestoneDocumentReviewVersion {
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}

export function milestoneDocumentReviewVersionOf(
  cell: Pick<MilestoneDocumentCollectionCell, 'revision' | 'review'>,
): MilestoneDocumentReviewVersion | null {
  if (cell.revision === null || cell.revision < 1) return null;
  return {
    expectedRevision: cell.revision,

    expectedLatestReviewId: cell.review?.id ?? null,
  };
}

export function milestoneDocumentReviewVersionError(
  version: MilestoneDocumentReviewVersion | null,
): string | null {
  return version === null
    ? '이 칸의 제출 정보를 읽지 못해 검토할 수 없습니다. 표를 다시 불러 주세요.'
    : null;
}

export function isSameMilestoneDocumentReviewTarget(
  a: MilestoneDocumentReviewTarget,
  b: MilestoneDocumentReviewTarget,
): boolean {
  return a.applicationId === b.applicationId && a.documentId === b.documentId;
}

export interface MilestoneDocumentReviewFormState {
  readonly target: MilestoneDocumentReviewTarget;

  readonly version: MilestoneDocumentReviewVersion | null;
  readonly decision: MilestoneDocumentReviewDecision | null;
  readonly comment: string;

  readonly resubmissionDueAt: string;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly history: readonly MilestoneDocumentCollectionHistory[];
  readonly historyNextCursor: string | null;
  readonly historyIsComplete: boolean;
  readonly isHistoryLoading: boolean;
  readonly historyError: string | null;
}

export function createMilestoneDocumentReviewFormState(
  target: MilestoneDocumentReviewTarget,
  version: MilestoneDocumentReviewVersion | null,
): MilestoneDocumentReviewFormState {
  return {
    target,
    version,
    decision: null,
    comment: '',
    resubmissionDueAt: '',
    isSubmitting: false,
    errorMessage: null,
    history: [],
    historyNextCursor: null,
    historyIsComplete: true,
    isHistoryLoading: true,
    historyError: null,
  };
}

export function nextMilestoneDocumentReviewState(
  current: MilestoneDocumentReviewFormState | null,
  target: MilestoneDocumentReviewTarget,
  version: MilestoneDocumentReviewVersion | null,
): MilestoneDocumentReviewFormState | null {
  if (
    current !== null &&
    isSameMilestoneDocumentReviewTarget(current.target, target)
  ) {
    return null;
  }
  return createMilestoneDocumentReviewFormState(target, version);
}
