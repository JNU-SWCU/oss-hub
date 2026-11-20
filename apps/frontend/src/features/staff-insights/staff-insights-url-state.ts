'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import {
  parseListEnum,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  insightsSearchParams,
  parseInsightsYearSearchParam,
} from './insights-year';
import {
  INSIGHTS_VIEWS,
  type InsightsYearScope,
  type StaffInsightsUrlState,
} from './types';

export function parseStaffInsightsSearchParams(
  params: URLSearchParams,
): StaffInsightsUrlState {
  return {
    scope: parseInsightsYearSearchParam(params.get('year')),
    view: parseListEnum(params.get('view'), INSIGHTS_VIEWS, 'students'),
  };
}
export const buildStaffInsightsSearchParams = insightsSearchParams;

const OWNED_PARAMS = ['year', 'view'] as const;

export function useStaffInsightsUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(
    serialized,
    parseStaffInsightsSearchParams,
  );
  const navigate = useListUrlNavigation(
    state,
    buildStaffInsightsSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  const onScopeChange = useCallback(
    (scope: InsightsYearScope) => navigate({ scope }),
    [navigate],
  );
  return { state, onScopeChange };
}
