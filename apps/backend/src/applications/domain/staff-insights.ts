import type { DepartmentCohort } from './department-cohort';
import type { InsightsYearScope } from './staff-insights-year';

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
