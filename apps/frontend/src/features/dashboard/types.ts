export type DashboardApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type DashboardSubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type DashboardRepositoryProvisionStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';
export type DashboardRepositoryInvitationStatus =
  'PENDING' | 'SUCCEEDED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | null;

export interface DashboardMilestone {
  readonly id: string;
  readonly name: string;
  readonly dueAt: string;
  readonly submissionStatus: DashboardSubmissionStatus;
  readonly requiredItemCount?: number;
  readonly remainingItemCount?: number;
}

export interface DashboardProgress {
  readonly approvedCount: number;
  readonly inReviewCount: number;
  readonly totalCount: number;
}

export interface DashboardItem {
  readonly coverImageUrl?: string | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;

  readonly teamName: string;

  readonly teamUrl: string;
  readonly applicationStatus: DashboardApplicationStatus;
  readonly nextMilestone: DashboardMilestone | null;
  readonly progress?: DashboardProgress | null;
  readonly detailUrl: string;
  readonly checklistUrl: string;
  readonly repository: {
    readonly repositoryName: string | null;
    readonly provisionStatus: DashboardRepositoryProvisionStatus;
    readonly invitationStatus: DashboardRepositoryInvitationStatus;
    readonly githubUrl: string | null;
  } | null;
}

export interface StudentDashboard {
  readonly items: readonly DashboardItem[];
}

export interface ApplicationDecisionNotice {
  readonly id: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;

  readonly decision: 'APPROVED' | 'REJECTED' | 'SUBMITTED';
  readonly decidedAt: string;
}

export type StudentDashboardStatus = 'loading' | 'success' | 'error';

export interface DashboardFeedbackItem {
  readonly id: string;
  readonly decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  readonly comment: string | null;
  readonly reviewedAt: string;
  readonly resubmissionDueAt: string | null;
  readonly applicationId: string;
  readonly programId: string;
  readonly milestoneId: string;
  readonly milestoneName: string;
  readonly itemName: string;
  readonly href: string;
}

export type StudentFeedbackState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
      readonly status: 'success';
      readonly items: readonly DashboardFeedbackItem[];
    };
