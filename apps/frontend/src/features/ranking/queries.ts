import { useQuery } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import { getRanking, getRankingTimeline } from './api';
import { RANKING_YEAR_ALL, type RankingYear } from './types';

export const RANKING_POLL_MS = 5 * 60_000;

export function rankingRefetchDelay(
  nextCycleAt: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!nextCycleAt) return RANKING_POLL_MS;
  const untilNextCycle = Date.parse(nextCycleAt) - now;
  return Math.min(Math.max(untilNextCycle, 1_000), RANKING_POLL_MS);
}

export function useRankingQuery(
  year: RankingYear,
  page: number,
  pageSize: number,
) {
  return useQuery({
    queryKey: featureKey('ranking', year, page, pageSize),
    queryFn: ({ signal }) => getRanking(year, page, pageSize, signal),
    refetchInterval: (query) =>
      rankingRefetchDelay(query.state.data?.nextCycleAt),
  });
}

export function useRankingTimelineQuery(year: RankingYear) {
  return useQuery({
    queryKey: featureKey('ranking', 'timeline', year),
    queryFn: ({ signal }) => getRankingTimeline(Number(year), signal),
    enabled: year !== RANKING_YEAR_ALL,
    refetchInterval: RANKING_POLL_MS,
  });
}
