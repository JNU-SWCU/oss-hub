import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  currentRankingYear,
  parseRankingYearSearchParam,
  type RankingYear,
} from './types';

interface RankingUrlState {
  readonly year: RankingYear;
  readonly page: number;
}
export function parseRankingSearchParams(
  params: URLSearchParams,
): RankingUrlState {
  return {
    year: parseRankingYearSearchParam(params.get('year')),
    page: parseListPage(params.get('page')),
  };
}
export function buildRankingSearchParams(state: RankingUrlState) {
  const params = new URLSearchParams();
  if (state.year !== currentRankingYear())
    params.set('year', String(state.year));
  setListPage(params, state.page);
  return params;
}

const OWNED_PARAMS = ['year', 'page'] as const;

export function useRankingUrlState() {
  const serialized = useSearchParams().toString();
  const state = useParsedListUrlState(serialized, parseRankingSearchParams);
  const navigate = useListUrlNavigation(
    state,
    buildRankingSearchParams,
    OWNED_PARAMS,
    serialized,
  );
  return { state, navigate };
}
