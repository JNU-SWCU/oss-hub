import {
  DEPARTMENT_COHORTS,
  type DepartmentCohort,
} from '@/lib/department-cohort';

export { DEPARTMENT_COHORTS, type DepartmentCohort };

export const INSIGHTS_VIEWS = ['students', 'groups', 'programs'] as const;

export type InsightsView = (typeof INSIGHTS_VIEWS)[number];

export type InsightsYearScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'calendar'; readonly year: number };

export interface StaffInsightsUrlState {
  readonly scope: InsightsYearScope;
  readonly view: InsightsView;
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
  readonly activityPerStudent: number;
  readonly sampleTooSmall: boolean;
}

export interface StaffInsightsRecentLeaderRow {
  readonly rank: number;
  readonly name: string | null;
  readonly githubLogin: string;
  readonly department: string | null;
  readonly cohort: DepartmentCohort;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly total: number;
}

export interface StaffInsightsLeaderRow extends StaffInsightsRecentLeaderRow {
  readonly starCount: number;
}

export interface StaffInsightsCohortLeaders<Row> {
  readonly all: readonly Row[];
  readonly swMajor: readonly Row[];
  readonly nonSw: readonly Row[];
}

export interface StaffInsightsLeaders {
  readonly period: StaffInsightsCohortLeaders<StaffInsightsLeaderRow>;
  readonly recent: StaffInsightsCohortLeaders<StaffInsightsRecentLeaderRow>;
}

export const PROGRAM_CATEGORIES = [
  'BASIC',
  'SW_VALUE_SPREAD',
  'OSS_CONTEST',
  'CAPSTONE',
  'SW_CONVERGENCE',
  'GLOBAL_MAKERTHON',
  'CORPORATE_INTERNSHIP',
] as const;

export type ProgramCategory = (typeof PROGRAM_CATEGORIES)[number];

export const PROGRAM_CATEGORY_LABELS: Readonly<
  Record<ProgramCategory, string>
> = {
  BASIC: '기본',
  SW_VALUE_SPREAD: 'SW가치확산',
  OSS_CONTEST: 'OSS경진대회',
  CAPSTONE: '캡스톤',
  SW_CONVERGENCE: 'SW융합',
  GLOBAL_MAKERTHON: '글로벌메이커톤',
  CORPORATE_INTERNSHIP: '기업인턴십',
};

export interface StaffInsightsProgramRow {
  readonly programId: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly recruiting: boolean;
  readonly swMajorCount: number;
  readonly nonSwCount: number;
  readonly unregisteredCount: number;
  readonly participantCount: number;
  readonly appliedCount: number;
  readonly approvedCount: number;
  readonly competitionRatio: number | null;
  readonly dueRequirementCount: number;
  readonly submittedRequirementCount: number;
  readonly completionRate: number | null;
  readonly activeTeamCount: number;
  readonly repoTeamCount: number;
  readonly contributionsPerParticipant: number | null;
}

export interface StaffInsightsProgramSummary {
  readonly programCount: number;
  readonly recruitingCount: number;
  readonly approvedParticipantCount: number;
  readonly uniqueParticipantCount: number;
  readonly competitionRatio: number | null;
  readonly repeatParticipantCount: number;
  readonly repeatParticipantRate: number | null;
}

export interface StaffInsightsSummary {
  readonly scope: InsightsYearScope;
  readonly dataAsOf: Date | null;
  readonly years: readonly number[];
  readonly cohorts: readonly StaffInsightsCohortRow[];
  readonly departments: readonly StaffInsightsDepartmentRow[];
  readonly programs: readonly StaffInsightsProgramRow[];
  readonly programSummary: StaffInsightsProgramSummary;
  readonly leaders: StaffInsightsLeaders;
  readonly recentWindow: { readonly from: Date; readonly to: Date };
}

export const COHORT_LABELS: Readonly<Record<DepartmentCohort, string>> = {
  [DEPARTMENT_COHORTS.SW_MAJOR]: 'SW전공',
  [DEPARTMENT_COHORTS.NON_SW]: '비SW전공',
  [DEPARTMENT_COHORTS.UNREGISTERED]: '학과 미등록',
};
