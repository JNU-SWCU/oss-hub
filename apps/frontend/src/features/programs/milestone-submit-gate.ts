import type { MilestoneDocumentViewerSubmission } from './milestone-document-api';
import {
  isMilestoneDocumentDeadlineLocked,
  isMilestoneDocumentResubmittable,
  milestoneDocumentViewerDisplay,
} from './milestone-document-review';
import type {
  BlockedMilestoneSubmissionAccess,
  MilestoneSubmissionAccess,
} from './milestone-submission-access';
import { isPastDue } from './program-detail-format';
import type { ProgramMilestone, SubmissionStatus } from './types';

export type MilestoneDocumentSubmitGate =
  | { readonly kind: 'open' }
  | { readonly kind: 'settled'; readonly note: string }
  | { readonly kind: 'held'; readonly note: string };

export function milestoneDocumentSubmitGate({
  submissionAccess,
  viewerSubmission,
  closed,
}: {
  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly viewerSubmission: MilestoneDocumentViewerSubmission | undefined;

  readonly closed: boolean;
}): MilestoneDocumentSubmitGate {
  if (!isMilestoneDocumentResubmittable(viewerSubmission)) {
    return {
      kind: 'settled',
      note:
        milestoneDocumentViewerDisplay(viewerSubmission) === 'APPROVED'
          ? '승인된 제출 항목은 다시 제출할 수 없습니다.'
          : '반려된 제출 항목은 다시 제출할 수 없습니다.',
    };
  }

  if (isMilestoneDocumentDeadlineLocked(closed, viewerSubmission)) {
    return { kind: 'held', note: '마감이 지나 제출할 수 없습니다' };
  }

  if (submissionAccess.kind === 'blocked') {
    return { kind: 'held', note: submissionAccess.buttonNote };
  }
  return { kind: 'open' };
}

export type MilestoneRowSubmitGate =
  | { readonly kind: 'settled'; readonly status: SubmissionStatus }
  | {
      readonly kind: 'blocked';
      readonly access: BlockedMilestoneSubmissionAccess;
    }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'open';
      readonly status: SubmissionStatus;
      readonly resubmission: boolean;
    };

export function milestoneRowSubmitGate(
  milestone: Pick<ProgramMilestone, 'dueAt' | 'viewerSubmissionStatus'>,
  submissionAccess: MilestoneSubmissionAccess,
): MilestoneRowSubmitGate {
  if (submissionAccess.kind === 'unchanged') return { kind: 'unchanged' };
  const status = milestone.viewerSubmissionStatus;
  if (status !== null) {
    const resubmission = status === 'CHANGES_REQUESTED';

    if (
      !resubmission &&
      !(status === 'NOT_SUBMITTED' && !isPastDue(milestone.dueAt))
    ) {
      return { kind: 'settled', status };
    }
    if (submissionAccess.kind === 'blocked') {
      return { kind: 'blocked', access: submissionAccess };
    }
    return { kind: 'open', status, resubmission };
  }

  if (submissionAccess.kind === 'blocked') {
    return { kind: 'blocked', access: submissionAccess };
  }
  return { kind: 'unknown' };
}
