import type { InsightsYearScope } from './types';

export function parseInsightsYearSearchParam(
  raw: string | null | undefined,
): InsightsYearScope {
  if (raw === null || raw === undefined || raw === '') {
    return { kind: 'all' };
  }
  if (raw.toLowerCase() === 'all') {
    return { kind: 'all' };
  }
  if (!/^(20\d{2}|2100)$/.test(raw)) {
    return { kind: 'all' };
  }
  return { kind: 'calendar', year: Number(raw) };
}

export function insightsPageHref(scope: InsightsYearScope): string {
  if (scope.kind === 'all') {
    return '/dashboard/insights';
  }
  return `/dashboard/insights?year=${scope.year}`;
}

export function insightsRequestPath(scope: InsightsYearScope): string {
  if (scope.kind === 'all') {
    return 'dashboard/staff/insights';
  }
  return `dashboard/staff/insights?year=${scope.year}`;
}
