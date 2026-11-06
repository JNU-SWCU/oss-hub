import type { RequirementViewerSubmission } from './requirement-dto';
import {
  isRequirementDeadlineLocked,
  isRequirementResubmittable,
  requirementViewerDisplay,
} from './requirement-review';
import type {
  BlockedMilestoneSubmissionAccess,
  MilestoneSubmissionAccess,
} from './milestone-submission-access';
import { isPastDue } from '../catalog/program-detail-format';
import type { ProgramMilestone } from '../catalog/dto';
import type { SubmissionStatus } from '../program-contract';

export type RequirementSubmitGate =
  | { readonly kind: 'open' }
  | { readonly kind: 'settled'; readonly note: string }
  | { readonly kind: 'held'; readonly note: string };

export function requirementSubmitGate({
  submissionAccess,
  viewerSubmission,
  closed,
  graceDueAt = null,
  now = Date.now(),
}: {
  readonly submissionAccess: MilestoneSubmissionAccess;
  readonly viewerSubmission: RequirementViewerSubmission | undefined;

  readonly closed: boolean;
  readonly graceDueAt?: string | null;
  readonly now?: number;
}): RequirementSubmitGate {
  if (!isRequirementResubmittable(viewerSubmission)) {
    return {
      kind: 'settled',
      note:
        requirementViewerDisplay(viewerSubmission) === 'APPROVED'
          ? '승인된 제출 항목은 다시 제출할 수 없습니다.'
          : '반려된 제출 항목은 다시 제출할 수 없습니다.',
    };
  }

  const graceOpen =
    graceDueAt !== null &&
    Number.isFinite(Date.parse(graceDueAt)) &&
    now <= Date.parse(graceDueAt) &&
    viewerSubmission?.review == null &&
    viewerSubmission?.status !== 'CHANGES_REQUESTED';
  if (
    isRequirementDeadlineLocked(
      closed || (graceDueAt !== null && isPastDue(graceDueAt, now)),
      viewerSubmission,
    ) &&
    !graceOpen
  ) {
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
