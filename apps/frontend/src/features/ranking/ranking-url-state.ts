import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  parseListPage,
  setListPage,
  useListUrlNavigation,
  useParsedListUrlState,
} from '@/lib/list-url-state';
import {
  parseRankingYearSearchParam,
  RANKING_YEAR_ALL,
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
  if (state.year !== RANKING_YEAR_ALL) params.set('year', String(state.year));
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
  useEffect(() => {
    const yearParam = new URLSearchParams(serialized).get('year');
    if (yearParam?.toLowerCase() === RANKING_YEAR_ALL) {
      navigate({}, 'replace');
    }
  }, [serialized, navigate]);
  return { state, navigate };
}
