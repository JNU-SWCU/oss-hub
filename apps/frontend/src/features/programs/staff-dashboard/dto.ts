import type { ProgramTrackType } from '../program-contract';

export const STAFF_DASHBOARD_SORTS = [
  'name',
  'deadline',
  'submission',
  'pending',
] as const;

export type StaffDashboardSort = (typeof STAFF_DASHBOARD_SORTS)[number];

export const STAFF_DASHBOARD_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type StaffDashboardSortDirection =
  (typeof STAFF_DASHBOARD_SORT_DIRECTIONS)[number];

export interface StaffDashboardApplicationCounts {
  readonly total: number;
  readonly pendingApproval: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface StaffDashboardActivitySummary {
  readonly repositories: number;
  readonly commits: number;
  readonly pullRequests: number;
  readonly releases: number;
  readonly lastActivityAt: string | null;
  readonly dataAsOf: string | null;
}

export interface StaffDashboardSubmissionSummary {
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

export type StaffDashboardMilestoneSummary = {
  readonly id: string;
  readonly name: string;
  readonly startAt: string;
  readonly dueAt: string;
} & (
  | { readonly submittedTeams: number; readonly totalTeams: number }
  | { readonly submittedTeams: null; readonly totalTeams: null }
);

export interface StaffDashboardProgramSummary {
  readonly coverImageUrl?: string | null;
  readonly id: string;
  readonly name: string;
  readonly trackType: ProgramTrackType | null;
  readonly applicationPeriod: {
    readonly startsAt: string;
    readonly endsAt: string;
  };

  readonly endAt: string;

  readonly applications: StaffDashboardApplicationCounts;
  readonly activity: StaffDashboardActivitySummary;
  readonly submissions: StaffDashboardSubmissionSummary;
  readonly milestones: readonly StaffDashboardMilestoneSummary[];
}

export interface StaffDashboardStatusSummary {
  readonly recruiting: number;
  readonly inProgress: number;
  readonly ended: number;
}

export interface StaffDashboardSummary {
  readonly programs: readonly StaffDashboardProgramSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly catalogTotal: number;
  readonly statusSummary: StaffDashboardStatusSummary;
}
