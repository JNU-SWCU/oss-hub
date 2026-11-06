import type {
  RequirementSubmissionStatus,
  RequirementViewerSubmission,
} from './requirement-dto';
import type {
  RequirementCollectionCell,
  RequirementCollectionHistory,
} from './requirement-collection-dto';
import type { RequirementReviewDecision } from './requirement-review-dto';
import {
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
} from '@/lib/status-vocabulary';

export type RequirementReviewDisplay =
  'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export const REQUIREMENT_REVIEW_DISPLAY_LABELS = {
  NOT_SUBMITTED: SUBMISSION_STATUS_LABELS.NOT_SUBMITTED,
  PENDING: SUBMISSION_STATUS_LABELS.SUBMITTED,
  APPROVED: SUBMISSION_STATUS_LABELS.APPROVED,
  CHANGES_REQUESTED: SUBMISSION_STATUS_LABELS.CHANGES_REQUESTED,
  REJECTED: SUBMISSION_STATUS_LABELS.REJECTED,
} as const satisfies Readonly<Record<RequirementReviewDisplay, string>>;

export const REQUIREMENT_REVIEW_DISPLAY_VARIANTS = {
  NOT_SUBMITTED: SUBMISSION_STATUS_BADGE.NOT_SUBMITTED,
  PENDING: SUBMISSION_STATUS_BADGE.SUBMITTED,
  APPROVED: SUBMISSION_STATUS_BADGE.APPROVED,
  CHANGES_REQUESTED: SUBMISSION_STATUS_BADGE.CHANGES_REQUESTED,
  REJECTED: SUBMISSION_STATUS_BADGE.REJECTED,
} as const satisfies Readonly<
  Record<
    RequirementReviewDisplay,
    'closed' | 'recruiting' | 'approved' | 'pending' | 'rejected'
  >
>;

export const REQUIREMENT_REVIEW_DECISION_ORDER: readonly RequirementReviewDecision[] =
  ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'];

function submittedDisplay(
  status: RequirementSubmissionStatus | null,
): RequirementReviewDisplay {
  return status === null || status === 'SUBMITTED' ? 'PENDING' : status;
}

export function requirementCellDisplay(
  cell: Pick<RequirementCollectionCell, 'isSubmitted' | 'status'>,
): RequirementReviewDisplay {
  if (!cell.isSubmitted) return 'NOT_SUBMITTED';
  return submittedDisplay(cell.status);
}

export function requirementViewerDisplay(
  viewerSubmission: RequirementViewerSubmission | undefined,
): RequirementReviewDisplay {
  if (viewerSubmission === undefined || !viewerSubmission.submitted) {
    return 'NOT_SUBMITTED';
  }
  return submittedDisplay(viewerSubmission.status);
}

export function isRequirementResubmittable(
  viewerSubmission: RequirementViewerSubmission | undefined,
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

export function isRequirementDeadlineLocked(
  closed: boolean,
  viewerSubmission: RequirementViewerSubmission | undefined,
): boolean {
  return closed && viewerSubmission?.status !== 'CHANGES_REQUESTED';
}

export function isRequirementResubmissionFinal(
  closed: boolean,
  viewerSubmission: RequirementViewerSubmission | undefined,
): boolean {
  return closed && viewerSubmission?.status === 'CHANGES_REQUESTED';
}

export function shouldHighlightRequirementReview(
  display: RequirementReviewDisplay,
): boolean {
  return display === 'CHANGES_REQUESTED' || display === 'REJECTED';
}

export type RequirementReviewNoticeTone = 'warning' | 'neutral';

export function requirementReviewNoticeTone(
  display: RequirementReviewDisplay,
  comment: string | null,
): RequirementReviewNoticeTone | null {
  if (shouldHighlightRequirementReview(display)) return 'warning';
  if (display !== 'APPROVED') return null;

  return comment !== null && comment.trim() !== '' ? 'neutral' : null;
}

export { requirementReviewFormError } from '@/lib/requirement-review';

export function requirementReviewCommentPayload(
  comment: string,
): string | undefined {
  const trimmed = comment.trim();
  return trimmed === '' ? undefined : trimmed;
}

export interface RequirementReviewTarget {
  readonly teamId: string;
  readonly documentId: string;
}

export interface RequirementReviewVersion {
  readonly expectedRevision: number;
  readonly expectedLatestReviewId: string | null;
}

export function requirementReviewVersionOf(
  cell: Pick<RequirementCollectionCell, 'revision' | 'review'>,
): RequirementReviewVersion | null {
  if (cell.revision === null || cell.revision < 1) return null;
  return {
    expectedRevision: cell.revision,

    expectedLatestReviewId: cell.review?.id ?? null,
  };
}

export function requirementReviewVersionError(
  version: RequirementReviewVersion | null,
): string | null {
  return version === null
    ? '이 칸의 제출 정보를 읽지 못해 검토할 수 없습니다. 표를 다시 불러 주세요.'
    : null;
}

export function isSameRequirementReviewTarget(
  a: RequirementReviewTarget,
  b: RequirementReviewTarget,
): boolean {
  return a.teamId === b.teamId && a.documentId === b.documentId;
}

export interface RequirementReviewFormState {
  readonly target: RequirementReviewTarget;

  readonly version: RequirementReviewVersion | null;
  readonly decision: RequirementReviewDecision | null;
  readonly comment: string;

  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly history: readonly RequirementCollectionHistory[];
  readonly historyNextCursor: string | null;
  readonly historyIsComplete: boolean;
  readonly isHistoryLoading: boolean;
  readonly historyError: string | null;
}

export function createRequirementReviewFormState(
  target: RequirementReviewTarget,
  version: RequirementReviewVersion | null,
): RequirementReviewFormState {
  return {
    target,
    version,
    decision: null,
    comment: '',
    isSubmitting: false,
    errorMessage: null,
    history: [],
    historyNextCursor: null,
    historyIsComplete: true,
    isHistoryLoading: true,
    historyError: null,
  };
}

export function nextRequirementReviewState(
  current: RequirementReviewFormState | null,
  target: RequirementReviewTarget,
  version: RequirementReviewVersion | null,
): RequirementReviewFormState | null {
  if (
    current !== null &&
    isSameRequirementReviewTarget(current.target, target)
  ) {
    return null;
  }
  return createRequirementReviewFormState(target, version);
}
