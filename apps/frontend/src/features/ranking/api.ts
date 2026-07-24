import { apiClient } from '@/lib/api-client';
import {
  RANKING_NOTICE,
  RANKING_PERIODS,
  type RankingItem,
  type RankingPage,
  type RankingPeriod,
} from './types';

export class RankingResponseError extends Error {
  constructor() {
    super('랭킹 API 응답 형식이 올바르지 않습니다.');
    this.name = 'RankingResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRankingPeriod(value: unknown): value is RankingPeriod {
  return value === RANKING_PERIODS.THIS_YEAR || value === RANKING_PERIODS.ALL;
}

function isRankingItem(value: unknown): value is RankingItem {
  return (
    isRecord(value) &&
    isPositiveInteger(value.rank) &&
    typeof value.displayName === 'string' &&
    typeof value.githubLogin === 'string' &&
    isNonNegativeInteger(value.commitCount) &&
    isNonNegativeInteger(value.prCount) &&
    isNonNegativeInteger(value.starCount) &&
    isNonNegativeInteger(value.total)
  );
}

export function parseRankingPage(value: unknown): RankingPage {
  if (
    !isRecord(value) ||
    value.notice !== RANKING_NOTICE ||
    !isRankingPeriod(value.period) ||
    !Array.isArray(value.items) ||
    !value.items.every(isRankingItem) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.pageSize) ||
    !isNonNegativeInteger(value.total)
  ) {
    throw new RankingResponseError();
  }

  return {
    notice: value.notice,
    period: value.period,
    items: value.items.map((item) => ({ ...item })),
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
  };
}

export async function getRanking(
  period: RankingPeriod,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<RankingPage> {
  const params = new URLSearchParams({
    period,
    page: String(page),
    pageSize: String(pageSize),
  });
  const response = await apiClient<unknown>(
    `ranking?${params.toString()}`,
    signal ? { signal } : undefined,
  );
  return parseRankingPage(response);
}
