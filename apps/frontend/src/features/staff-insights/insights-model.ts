import type {
  StaffInsightsCohortRow,
  StaffInsightsMetrics,
  StaffInsightsSummary,
} from './types';
import { COHORT_LABELS, DEPARTMENT_COHORTS } from './types';

export const COHORT_CHART_KEYS = [
  { key: 'swMajor', label: COHORT_LABELS[DEPARTMENT_COHORTS.SW_MAJOR] },
  { key: 'nonSw', label: COHORT_LABELS[DEPARTMENT_COHORTS.NON_SW] },
] as const;

type ActivityMetricField =
  | 'commitCount'
  | 'pullRequestCount'
  | 'issueCount'
  | 'repositoryCount'
  | 'starCount'
  | 'total';
export const ACTIVITY_METRICS: readonly {
  readonly field: ActivityMetricField;
  readonly label: string;
}[] = [
  { field: 'commitCount', label: 'Commit' },
  { field: 'pullRequestCount', label: 'PR' },
  { field: 'issueCount', label: 'Issue' },
  { field: 'repositoryCount', label: 'Repo' },
  { field: 'starCount', label: 'Star(누적)' },
  { field: 'total', label: '합계' },
];
export const EMPTY_COHORT_METRICS: StaffInsightsMetrics = {
  studentCount: 0,
  activeStudentCount: 0,
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
  total: 0,
  participantCount: 0,
};
export function cohortRow(
  summary: StaffInsightsSummary,
  cohort: StaffInsightsCohortRow['cohort'],
): StaffInsightsCohortRow {
  return (
    summary.cohorts.find((item) => item.cohort === cohort) ?? {
      cohort,
      ...EMPTY_COHORT_METRICS,
    }
  );
}

export function rate(numerator: number, denominator: number): string {
  return denominator === 0 ? 'x/0 (계산 불가)' : `${numerator}/${denominator}`;
}
