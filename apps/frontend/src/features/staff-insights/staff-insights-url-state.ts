import { useSearchParams } from 'next/navigation';
import {
  parseListEnum,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  insightsSearchParams,
  parseInsightsYearSearchParam,
} from './insights-year';
import { INSIGHTS_VIEWS, type StaffInsightsUrlState } from './types';
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
  return { state, navigate };
}
