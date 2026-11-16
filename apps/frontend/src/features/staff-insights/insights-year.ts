import type { InsightsYearScope, StaffInsightsUrlState } from './types';

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

export function insightsSearchParams({
  scope,
  view,
}: StaffInsightsUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.kind === 'calendar') params.set('year', String(scope.year));
  if (view !== 'students') params.set('view', view);
  return params;
}

export function insightsPageHref(state: StaffInsightsUrlState): string {
  const query = insightsSearchParams(state).toString();
  return query === '' ? '/dashboard/insights' : `/dashboard/insights?${query}`;
}

export function insightsRequestPath(scope: InsightsYearScope): string {
  if (scope.kind === 'all') {
    return 'dashboard/staff/insights';
  }
  return `dashboard/staff/insights?year=${scope.year}`;
}
