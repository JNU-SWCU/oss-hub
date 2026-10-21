import type { ProgramTrackType } from '../program-contract';
import type { ProgramLifecycle } from '../program-lifecycle';

export interface StaffDashboardApplicationCounts {
  readonly total: number;
  readonly submitted: number;
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
  readonly approvedApplications: number;
  readonly milestones: number;
  readonly total: number;
  readonly notSubmitted: number;
  readonly submitted: number;
  readonly approved: number;
  readonly changesRequested: number;
  readonly rejected: number;
}

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

  readonly lifecycle?: ProgramLifecycle;
  readonly applications: StaffDashboardApplicationCounts;
  readonly teamManagementPath: string;
  readonly activity: StaffDashboardActivitySummary;
  readonly submissions: StaffDashboardSubmissionSummary;
}

export interface StaffDashboardSummary {
  readonly programs: readonly StaffDashboardProgramSummary[];
}
