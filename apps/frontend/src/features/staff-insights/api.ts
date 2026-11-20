import { apiClient, withQuery } from '@/lib/api-client';
import { isRecord } from '@/lib/is-record';
import { insightsRequestPath } from './insights-year';
import type {
  StaffInsightsFinderData,
  StaffInsightsFinderQuery,
} from './leaderboard-panel';
import { parseStaffInsightsSummary } from './parser';
import type { InsightsYearScope, StaffInsightsSummary } from './types';

export async function getStaffInsights(
  scope: InsightsYearScope,
  signal: AbortSignal | undefined,
): Promise<StaffInsightsSummary> {
  const options = signal === undefined ? undefined : { signal };
  const response = await apiClient<unknown>(
    insightsRequestPath(scope),
    options,
  );
  return parseStaffInsightsSummary(response);
}

export async function getStaffInsightsStudents(
  scope: InsightsYearScope,
  query: StaffInsightsFinderQuery,
  signal: AbortSignal,
): Promise<StaffInsightsFinderData> {
  const params = new URLSearchParams();
  if (scope.kind === 'calendar') params.set('year', String(scope.year));
  const search = query.search.trim();
  if (search) params.set('search', search);
  if (query.department) params.set('department', query.department);
  if (query.programId) params.set('programId', query.programId);
  if (query.minActivity > 0)
    params.set('minActivity', String(query.minActivity));
  if (query.recentActivity !== 'all')
    params.set('recentActivity', query.recentActivity);
  if (query.sort !== 'total') params.set('sort', query.sort);
  if (query.direction !== 'desc') params.set('direction', query.direction);
  if (query.page > 1) params.set('page', String(query.page));

  const response = await apiClient<unknown>(
    withQuery('dashboard/staff/insights/students', params),
    { signal, cache: 'no-store' },
  );
  return parseFinderPage(response);
}

function invalidFinderResponse(): never {
  throw new Error('학생 검색 API 응답 형식이 올바르지 않습니다.');
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseFinderRow(
  value: unknown,
): StaffInsightsFinderData['rows'][number] {
  if (!isRecord(value)) return invalidFinderResponse();
  const {
    name,
    githubLogin,
    studentId,
    major,
    total,
    recentTotal,
    collaborationRatio,
    programIds,
  } = value;
  if (
    !isNonEmptyString(githubLogin) ||
    !isNullableString(name) ||
    !isNullableString(studentId) ||
    !isNullableString(major) ||
    !isCount(total) ||
    (recentTotal !== null && !isCount(recentTotal)) ||
    (collaborationRatio !== null &&
      !(
        typeof collaborationRatio === 'number' &&
        collaborationRatio >= 0 &&
        collaborationRatio <= 1
      )) ||
    !Array.isArray(programIds) ||
    !programIds.every(isNonEmptyString)
  ) {
    return invalidFinderResponse();
  }
  return {
    name,
    githubLogin,
    studentId,
    major,
    total,
    recentTotal,
    collaborationRatio,
    programIds,
  };
}

function parseFinderPage(value: unknown): StaffInsightsFinderData {
  if (!isRecord(value)) return invalidFinderResponse();
  const { rows, page, pageSize, total } = value;
  if (
    !isCount(page) ||
    page === 0 ||
    !isCount(pageSize) ||
    pageSize === 0 ||
    !isCount(total) ||
    !Array.isArray(rows) ||
    rows.length > Math.min(pageSize, total)
  ) {
    return invalidFinderResponse();
  }
  return { rows: rows.map(parseFinderRow), page, pageSize, total };
}
