import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getRanking } from './api';
import type { RankingYear } from './types';

export function useRankingQuery(
  year: RankingYear,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: featureKey('ranking', year, page, pageSize),
    queryFn: ({ signal }) => getRanking(year, page, pageSize, signal),
  });
}
