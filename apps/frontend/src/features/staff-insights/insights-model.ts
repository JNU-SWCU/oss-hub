import type {
  StaffInsightsCohortRow,
  StaffInsightsMetrics,
  StaffInsightsSummary,
} from './types';

const EMPTY_COHORT_METRICS: StaffInsightsMetrics = {
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
