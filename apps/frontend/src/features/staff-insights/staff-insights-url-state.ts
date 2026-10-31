import { useSearchParams } from 'next/navigation';
import {
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import { parseInsightsYearSearchParam } from './insights-year';
import type { InsightsYearScope } from './types';
export function parseStaffInsightsSearchParams(
  params: URLSearchParams,
): InsightsYearScope {
  return parseInsightsYearSearchParam(params.get('year'));
}
export function buildStaffInsightsSearchParams(state: InsightsYearScope) {
  const params = new URLSearchParams();
  if (state.kind === 'calendar') params.set('year', String(state.year));
  return params;
}

const OWNED_PARAMS = ['year'] as const;

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
  return { state, navigate };
}
