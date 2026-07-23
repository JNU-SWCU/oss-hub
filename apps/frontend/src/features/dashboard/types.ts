export type DashboardApplicationMode = 'PERSONAL' | 'TEAM';
export type DashboardApplicationStatus =
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED';
export type DashboardSubmissionStatus =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED';

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
}

export interface StudentDashboard {
  readonly items: readonly DashboardItem[];
}

export type StudentDashboardStatus = 'loading' | 'success' | 'error';
