import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getRanking, getRankingTimeline } from './api';
import { RANKING_YEAR_ALL, type RankingYear } from './types';

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

export function useRankingTimelineQuery(year: RankingYear) {
  return useQuery({
    queryKey: featureKey('ranking', 'timeline', year),
    queryFn: ({ signal }) => getRankingTimeline(Number(year), signal),
    enabled: year !== RANKING_YEAR_ALL,
  });
}
