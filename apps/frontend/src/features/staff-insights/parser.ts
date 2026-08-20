import type {
  DepartmentCohort,
  InsightsYearScope,
  StaffInsightsCohortRow,
  StaffInsightsDepartmentRow,
  StaffInsightsMetrics,
  StaffInsightsProgramRow,
  StaffInsightsSummary,
} from './types';
import { DEPARTMENT_COHORTS } from './types';

export class StaffInsightsResponseError extends Error {
  constructor() {
    super('학생 활성 API 응답 형식이 올바르지 않습니다.');
    this.name = 'StaffInsightsResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCohort(value: unknown): value is DepartmentCohort {
  return (
    value === DEPARTMENT_COHORTS.SW_MAJOR ||
    value === DEPARTMENT_COHORTS.NON_SW ||
    value === DEPARTMENT_COHORTS.UNREGISTERED
  );
}

function parseScope(value: unknown): InsightsYearScope | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return null;
  }
  if (value.kind === 'all' && value.year === undefined) {
    return { kind: 'all' };
  }
  if (
    value.kind === 'calendar' &&
    typeof value.year === 'number' &&
    Number.isInteger(value.year)
  ) {
    return { kind: 'calendar', year: value.year };
  }
  return null;
}

function parseMetrics(
  value: Record<string, unknown>,
): StaffInsightsMetrics | null {
  if (
    !isNonNegativeInteger(value.studentCount) ||
    !isNonNegativeInteger(value.activeStudentCount) ||
    !isNonNegativeInteger(value.commitCount) ||
    !isNonNegativeInteger(value.pullRequestCount) ||
    !isNonNegativeInteger(value.issueCount) ||
    !isNonNegativeInteger(value.repositoryCount) ||
    !isNonNegativeInteger(value.starCount) ||
    !isNonNegativeInteger(value.total) ||
    !isNonNegativeInteger(value.participantCount)
  ) {
    return null;
  }
  return {
    studentCount: value.studentCount,
    activeStudentCount: value.activeStudentCount,
    commitCount: value.commitCount,
    pullRequestCount: value.pullRequestCount,
    issueCount: value.issueCount,
    repositoryCount: value.repositoryCount,
    starCount: value.starCount,
    total: value.total,
    participantCount: value.participantCount,
  };
}

function parseCohort(value: unknown): StaffInsightsCohortRow | null {
  if (!isRecord(value) || !isCohort(value.cohort)) {
    return null;
  }
  const metrics = parseMetrics(value);
  return metrics === null ? null : { cohort: value.cohort, ...metrics };
}

function parseDepartment(value: unknown): StaffInsightsDepartmentRow | null {
  if (
    !isRecord(value) ||
    typeof value.department !== 'string' ||
    !isCohort(value.cohort)
  ) {
    return null;
  }
  const metrics = parseMetrics(value);
  return metrics === null
    ? null
    : { department: value.department, cohort: value.cohort, ...metrics };
}

function parseProgram(value: unknown): StaffInsightsProgramRow | null {
  if (
    !isRecord(value) ||
    typeof value.programId !== 'string' ||
    typeof value.name !== 'string' ||
    !isNonNegativeInteger(value.swMajorCount) ||
    !isNonNegativeInteger(value.nonSwCount) ||
    !isNonNegativeInteger(value.unregisteredCount) ||
    !isNonNegativeInteger(value.participantCount)
  ) {
    return null;
  }
  return {
    programId: value.programId,
    name: value.name,
    swMajorCount: value.swMajorCount,
    nonSwCount: value.nonSwCount,
    unregisteredCount: value.unregisteredCount,
    participantCount: value.participantCount,
  };
}

export function parseStaffInsightsSummary(
  value: unknown,
): StaffInsightsSummary {
  if (
    !isRecord(value) ||
    !Array.isArray(value.years) ||
    !value.years.every(
      (year) => typeof year === 'number' && Number.isInteger(year),
    ) ||
    !Array.isArray(value.cohorts) ||
    !Array.isArray(value.departments) ||
    !Array.isArray(value.programs)
  ) {
    throw new StaffInsightsResponseError();
  }
  const scope = parseScope(value.scope);
  const cohorts = value.cohorts.map(parseCohort);
  const departments = value.departments.map(parseDepartment);
  const programs = value.programs.map(parseProgram);
  if (
    scope === null ||
    cohorts.some((row) => row === null) ||
    departments.some((row) => row === null) ||
    programs.some((row) => row === null)
  ) {
    throw new StaffInsightsResponseError();
  }
  const dataAsOf = value.dataAsOf;
  if (
    dataAsOf !== null &&
    (typeof dataAsOf !== 'string' || Number.isNaN(Date.parse(dataAsOf)))
  ) {
    throw new StaffInsightsResponseError();
  }
  return {
    scope,
    dataAsOf: dataAsOf === null ? null : new Date(dataAsOf),
    years: value.years,
    cohorts: cohorts as readonly StaffInsightsCohortRow[],
    departments: departments as readonly StaffInsightsDepartmentRow[],
    programs: programs as readonly StaffInsightsProgramRow[],
  };
}
