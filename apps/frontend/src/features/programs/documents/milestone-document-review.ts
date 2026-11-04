import type {
  MilestoneDocumentSubmissionStatus,
  MilestoneDocumentViewerSubmission,
} from './milestone-document-dto';
import type {
  MilestoneDocumentCollectionCell,
  MilestoneDocumentCollectionHistory,
} from './milestone-document-collection-dto';
import type { MilestoneDocumentReviewDecision } from './milestone-document-review-dto';
import {
  SUBMISSION_STATUS_BADGE,
  SUBMISSION_STATUS_LABELS,
} from '@/lib/status-vocabulary';

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
): boolean {
  return closed && viewerSubmission?.status !== 'CHANGES_REQUESTED';
}

export function isMilestoneDocumentResubmissionFinal(
  closed: boolean,
  viewerSubmission: MilestoneDocumentViewerSubmission | undefined,
): boolean {
  return closed && viewerSubmission?.status === 'CHANGES_REQUESTED';
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

export { milestoneDocumentReviewFormError } from '@/lib/requirement-review';

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
