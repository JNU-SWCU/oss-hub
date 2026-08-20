import {
  DEPARTMENT_COHORTS,
  type DepartmentCohort,
} from '@/lib/department-cohort';

export { DEPARTMENT_COHORTS, type DepartmentCohort };

export const INSIGHTS_CUTS = {
  COHORT: 'cohort',
  DEPARTMENT: 'department',
} as const;

export type InsightsCut = (typeof INSIGHTS_CUTS)[keyof typeof INSIGHTS_CUTS];

export type InsightsYearScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'calendar'; readonly year: number };

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

export const COHORT_LABELS: Readonly<Record<DepartmentCohort, string>> = {
  [DEPARTMENT_COHORTS.SW_MAJOR]: 'SW전공',
  [DEPARTMENT_COHORTS.NON_SW]: '비SW전공',
  [DEPARTMENT_COHORTS.UNREGISTERED]: '학과 미등록',
};
