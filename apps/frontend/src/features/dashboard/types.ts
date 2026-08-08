export type DashboardApplicationMode = 'PERSONAL' | 'TEAM';
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
}

export interface DashboardItem {
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly applicationMode: DashboardApplicationMode;
  readonly displayName: string;
  readonly applicationStatus: DashboardApplicationStatus;
  readonly nextMilestone: DashboardMilestone | null;
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
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly decidedAt: string;
}

export type StudentDashboardStatus = 'loading' | 'success' | 'error';
