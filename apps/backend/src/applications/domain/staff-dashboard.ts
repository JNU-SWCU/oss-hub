import type {
  StaffDashboardApplicationCounts,
  StaffDashboardProgramSummary,
} from './application-records';

export type StaffDashboardComposedApplicationCounts =
  StaffDashboardApplicationCounts & {
    readonly pendingApproval: number;
  };

export interface StaffDashboardActivitySummary {
  readonly repositories: number;
  readonly commits: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
}

export interface StaffDashboardSubmissionSummary {
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

export type StaffDashboardComposedProgramSummary = Omit<
  StaffDashboardProgramSummary,
  'applications'
> & {
  readonly applications: StaffDashboardComposedApplicationCounts;
  readonly activity: StaffDashboardActivitySummary;
  readonly submissions: StaffDashboardSubmissionSummary;
};

export interface StaffDashboardComposedSummary {
  readonly programs: readonly StaffDashboardComposedProgramSummary[];
}
