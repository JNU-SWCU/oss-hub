import { isRecord } from '@/lib/is-record';
import type {
  DepartmentCohort,
  InsightsYearScope,
  StaffInsightsAttentionStudentRow,
  StaffInsightsCohortRow,
  StaffInsightsCohortLeaders,
  StaffInsightsDepartmentRow,
  StaffInsightsLeaderRow,
  StaffInsightsLeaders,
  StaffInsightsMetrics,
  ProgramCategory,
  StaffInsightsPeriodLeaderRow,
  StaffInsightsProgramRow,
  StaffInsightsProgramSummary,
  StaffInsightsSummary,
} from './types';
import { DEPARTMENT_COHORTS, PROGRAM_CATEGORIES } from './types';

const MAX_PERIOD_LEADERS = 12;
const MAX_RECENT_LEADERS = 10;
const MAX_ATTENTION_STUDENTS = 4;

class StaffInsightsResponseError extends Error {
  constructor() {
    super('인사이트 API 응답 형식이 올바르지 않습니다.');
    this.name = 'StaffInsightsResponseError';
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableRatio(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  );
}

function isNullablePercent(value: unknown): value is number | null {
  return value === null || (isNonNegativeInteger(value) && value <= 100);
}

function isProgramCategory(value: unknown): value is ProgramCategory {
  return PROGRAM_CATEGORIES.some((category) => category === value);
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
    !isNonNegativeInteger(value.participantCount)
  ) {
    return null;
  }
  return {
    studentCount: value.studentCount,
    activeStudentCount: value.activeStudentCount,
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
    !isNullableString(value.major) ||
    !isCohort(value.cohort) ||
    typeof value.activityPerStudent !== 'number' ||
    !Number.isFinite(value.activityPerStudent) ||
    value.activityPerStudent < 0 ||
    !isNullableRatio(value.recentPerStudent) ||
    typeof value.sampleTooSmall !== 'boolean'
  ) {
    return null;
  }
  const metrics = parseMetrics(value);
  return metrics === null
    ? null
    : {
        department: value.department,
        major: value.major,
        cohort: value.cohort,
        activityPerStudent: value.activityPerStudent,
        recentPerStudent: value.recentPerStudent,
        sampleTooSmall: value.sampleTooSmall,
        ...metrics,
      };
}

function parseLeader(value: unknown): StaffInsightsLeaderRow | null {
  if (
    !isRecord(value) ||
    !isPositiveInteger(value.rank) ||
    !isNullableString(value.name) ||
    typeof value.githubLogin !== 'string' ||
    value.githubLogin === '' ||
    !isNullableString(value.department) ||
    !isNonNegativeInteger(value.total)
  ) {
    return null;
  }
  return {
    rank: value.rank,
    name: value.name,
    githubLogin: value.githubLogin,
    department: value.department,
    total: value.total,
  };
}

function parsePeriodLeader(
  value: unknown,
): StaffInsightsPeriodLeaderRow | null {
  if (
    !isRecord(value) ||
    !isNullableString(value.studentId) ||
    !isNullableString(value.major) ||
    !isNullableCount(value.recentTotal) ||
    (value.previousRank !== null && !isPositiveInteger(value.previousRank)) ||
    !isNullableRatio(value.collaborationRatio) ||
    (value.collaborationRatio !== null && value.collaborationRatio > 1)
  ) {
    return null;
  }
  const leader = parseLeader(value);
  return leader === null
    ? null
    : {
        ...leader,
        studentId: value.studentId,
        major: value.major,
        recentTotal: value.recentTotal,
        previousRank: value.previousRank,
        collaborationRatio: value.collaborationRatio,
      };
}

function parseLimitedList<Row>(
  value: unknown,
  limit: number,
  parseRow: (row: unknown) => Row | null,
): readonly Row[] | null {
  if (!Array.isArray(value) || value.length > limit) {
    return null;
  }
  const rows = value.map(parseRow);
  return rows.every((row) => row !== null) ? rows : null;
}

function parseCohortLeaders<Row>(
  value: unknown,
  limit: number,
  parseRow: (row: unknown) => Row | null,
): StaffInsightsCohortLeaders<Row> | null {
  if (!isRecord(value)) {
    return null;
  }
  const all = parseLimitedList(value.all, limit, parseRow);
  const swMajor = parseLimitedList(value.swMajor, limit, parseRow);
  const nonSw = parseLimitedList(value.nonSw, limit, parseRow);
  return all === null || swMajor === null || nonSw === null
    ? null
    : { all, swMajor, nonSw };
}

function parseLeaders(value: unknown): StaffInsightsLeaders | null {
  if (!isRecord(value)) {
    return null;
  }
  const period = parseCohortLeaders(
    value.period,
    MAX_PERIOD_LEADERS,
    parsePeriodLeader,
  );
  const recent = parseCohortLeaders(
    value.recent,
    MAX_RECENT_LEADERS,
    parseLeader,
  );
  return period === null || recent === null ? null : { period, recent };
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return new Date(value);
}

function parseAttentionStudent(
  value: unknown,
): StaffInsightsAttentionStudentRow | null {
  if (
    !isRecord(value) ||
    !isNullableString(value.name) ||
    typeof value.githubLogin !== 'string' ||
    value.githubLogin === '' ||
    !isNullableString(value.studentId) ||
    !isNullableString(value.department) ||
    !isPositiveInteger(value.total)
  ) {
    return null;
  }
  const lastActiveAt = parseIsoDate(value.lastActiveAt);
  if (value.lastActiveAt !== null && lastActiveAt === null) {
    return null;
  }
  return {
    name: value.name,
    githubLogin: value.githubLogin,
    studentId: value.studentId,
    department: value.department,
    total: value.total,
    lastActiveAt,
  };
}

function parseRecentWindow(
  value: unknown,
): { readonly from: Date; readonly to: Date } | null {
  if (!isRecord(value)) {
    return null;
  }
  const from = parseIsoDate(value.from);
  const to = parseIsoDate(value.to);
  return from === null || to === null ? null : { from, to };
}

function parseProgram(value: unknown): StaffInsightsProgramRow | null {
  if (
    !isRecord(value) ||
    typeof value.programId !== 'string' ||
    typeof value.name !== 'string' ||
    !isProgramCategory(value.category) ||
    typeof value.recruiting !== 'boolean' ||
    !isNonNegativeInteger(value.swMajorCount) ||
    !isNonNegativeInteger(value.nonSwCount) ||
    !isNonNegativeInteger(value.unregisteredCount) ||
    !isNonNegativeInteger(value.participantCount) ||
    !isNonNegativeInteger(value.appliedCount) ||
    !isNonNegativeInteger(value.approvedCount) ||
    !isNullableRatio(value.competitionRatio) ||
    !isNonNegativeInteger(value.dueRequirementCount) ||
    !isNonNegativeInteger(value.submittedRequirementCount) ||
    !isNullablePercent(value.completionRate) ||
    !isNonNegativeInteger(value.activeTeamCount) ||
    !isNonNegativeInteger(value.repoTeamCount) ||
    !isNullableRatio(value.contributionsPerParticipant)
  ) {
    return null;
  }
  const startAt = parseIsoDate(value.startAt);
  const endAt = parseIsoDate(value.endAt);
  if (startAt === null || endAt === null) {
    return null;
  }
  return {
    programId: value.programId,
    name: value.name,
    category: value.category,
    startAt,
    endAt,
    recruiting: value.recruiting,
    swMajorCount: value.swMajorCount,
    nonSwCount: value.nonSwCount,
    unregisteredCount: value.unregisteredCount,
    participantCount: value.participantCount,
    appliedCount: value.appliedCount,
    approvedCount: value.approvedCount,
    competitionRatio: value.competitionRatio,
    dueRequirementCount: value.dueRequirementCount,
    submittedRequirementCount: value.submittedRequirementCount,
    completionRate: value.completionRate,
    activeTeamCount: value.activeTeamCount,
    repoTeamCount: value.repoTeamCount,
    contributionsPerParticipant: value.contributionsPerParticipant,
  };
}

function parseProgramSummary(
  value: unknown,
): StaffInsightsProgramSummary | null {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.programCount) ||
    !isNonNegativeInteger(value.recruitingCount) ||
    !isNonNegativeInteger(value.approvedParticipantCount) ||
    !isNonNegativeInteger(value.uniqueParticipantCount) ||
    !isNullableRatio(value.competitionRatio) ||
    !isNonNegativeInteger(value.repeatParticipantCount) ||
    !isNullablePercent(value.repeatParticipantRate)
  ) {
    return null;
  }
  return {
    programCount: value.programCount,
    recruitingCount: value.recruitingCount,
    approvedParticipantCount: value.approvedParticipantCount,
    uniqueParticipantCount: value.uniqueParticipantCount,
    competitionRatio: value.competitionRatio,
    repeatParticipantCount: value.repeatParticipantCount,
    repeatParticipantRate: value.repeatParticipantRate,
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
  const programSummary = parseProgramSummary(value.programSummary);
  const leaders = parseLeaders(value.leaders);
  const attentionStudents = parseLimitedList(
    value.attentionStudents,
    MAX_ATTENTION_STUDENTS,
    parseAttentionStudent,
  );
  const recentWindow = parseRecentWindow(value.recentWindow);
  if (
    scope === null ||
    programSummary === null ||
    leaders === null ||
    attentionStudents === null ||
    !isNullableCount(value.firstContributionCount) ||
    recentWindow === null ||
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
    programSummary,
    leaders,
    attentionStudents,
    firstContributionCount: value.firstContributionCount,
    recentWindow,
  };
}
