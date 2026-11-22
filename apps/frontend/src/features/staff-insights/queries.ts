'use client';

import { skipToken, useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getStaffInsights, getStaffInsightsStudents } from './api';
import type { StaffInsightsFinderQuery } from './leaderboard-panel';
import type { InsightsYearScope } from './types';

export function useStaffInsightsQuery(scope: InsightsYearScope) {
  return useQuery({
    queryKey: featureKey('staff-insights', scope),
    queryFn: ({ signal }) => getStaffInsights(scope, signal),
  });
}

export function useStaffInsightsFinderQuery(
  scope: InsightsYearScope,
  query: StaffInsightsFinderQuery | undefined,
) {
  return useQuery({
    queryKey: featureKey('staff-insights-students', scope, query),
    queryFn:
      query === undefined
        ? skipToken
        : ({ signal }) => getStaffInsightsStudents(scope, query, signal),
    gcTime: 0,
  });
}
