import type {
  StaffDashboardApplicationCounts,
  StaffDashboardProgramSummary,
} from '../programs/application-records.types';
import type { DepartmentCohort, InsightsYearScope } from './staff.policy';

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

export interface StaffInsightsMetrics {
  readonly studentCount: number;
  readonly activeStudentCount: number;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
  readonly participantCount: number;
}

export interface StaffInsightsCohortRow extends StaffInsightsMetrics {
  readonly cohort: DepartmentCohort;
}

export interface StaffInsightsDepartmentRow extends StaffInsightsMetrics {
  readonly department: string;
  readonly cohort: DepartmentCohort;
}

export interface StaffInsightsProgramRow {
  readonly programId: string;
  readonly name: string;
  readonly swMajorCount: number;
  readonly nonSwCount: number;
  readonly unregisteredCount: number;
  readonly participantCount: number;
}

export interface StaffInsightsSummary {
  readonly scope: InsightsYearScope;
  readonly dataAsOf: Date | null;
  readonly years: readonly number[];
  readonly cohorts: readonly StaffInsightsCohortRow[];
  readonly departments: readonly StaffInsightsDepartmentRow[];
  readonly programs: readonly StaffInsightsProgramRow[];
}
