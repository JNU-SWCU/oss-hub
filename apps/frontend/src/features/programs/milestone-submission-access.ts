import type { ApplicationStatus, ViewerRole } from './types';

type MilestoneSubmissionBlockedReason = 'NOT_APPLIED' | 'AWAITING_DECISION';

export interface BlockedMilestoneSubmissionAccess {
  readonly kind: 'blocked';
  readonly reason: MilestoneSubmissionBlockedReason;

  readonly notice: string;

  readonly buttonNote: string;
}

interface UnchangedMilestoneSubmissionAccess {
  readonly kind: 'unchanged';
}

export type MilestoneSubmissionAccess =
  | { readonly kind: 'open' }
  | UnchangedMilestoneSubmissionAccess
  | BlockedMilestoneSubmissionAccess;

const OPEN = { kind: 'open' } as const satisfies MilestoneSubmissionAccess;
const UNCHANGED = {
  kind: 'unchanged',
} as const satisfies MilestoneSubmissionAccess;

export function milestoneSubmissionAccess(viewer: {
  readonly role: ViewerRole;
  readonly applicationStatus: ApplicationStatus | null;
}): MilestoneSubmissionAccess {
  if (viewer.role !== 'STUDENT') return OPEN;
  switch (viewer.applicationStatus) {
    case 'APPROVED':
      return OPEN;
    case null:
      return {
        kind: 'blocked',
        reason: 'NOT_APPLIED',
        notice: '이 프로그램에 신청해야 제출할 수 있습니다.',
        buttonNote: '신청 후 제출할 수 있습니다',
      };
    case 'SUBMITTED':
      return {
        kind: 'blocked',
        reason: 'AWAITING_DECISION',
        notice: '신청 승인을 기다리는 중입니다. 승인되면 제출할 수 있습니다.',
        buttonNote: '승인 후 제출할 수 있습니다',
      };
    case 'REJECTED':
      return UNCHANGED;
  }
}
