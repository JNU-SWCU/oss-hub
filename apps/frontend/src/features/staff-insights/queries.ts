'use client';

import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getStaffInsights } from './api';
import type { InsightsYearScope } from './types';

export function useStaffInsightsQuery(scope: InsightsYearScope) {
  return useQuery({
    queryKey: featureKey('staff-insights', scope),
    queryFn: ({ signal }) => getStaffInsights(scope, signal),
  });
}
