import { apiClient } from '@/lib/api-client';
import {
  RANKING_YEAR_ALL,
  type RankingItem,
  type RankingPage,
  type RankingYear,
  type RankingYears,
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

function isRankingYear(value: unknown): value is RankingYear {
  if (value === RANKING_YEAR_ALL) return true;
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isRankingItem(value: unknown): value is RankingItem {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'rank',
      'displayName',
      'githubLogin',
      'commitCount',
      'prCount',
      'releaseCount',
      'total',
    ]) &&
    isPositiveInteger(value.rank) &&
    typeof value.displayName === 'string' &&
    typeof value.githubLogin === 'string' &&
    isNonNegativeInteger(value.commitCount) &&
    isNonNegativeInteger(value.prCount) &&
    isNonNegativeInteger(value.releaseCount) &&
    isNonNegativeInteger(value.total) &&
    value.total === value.commitCount + value.prCount + value.releaseCount
  );
}

export function parseRankingPage(value: unknown): RankingPage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['year', 'items', 'page', 'pageSize', 'total']) ||
    !isRankingYear(value.year) ||
    !Array.isArray(value.items) ||
    !value.items.every(isRankingItem) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.pageSize) ||
    !isNonNegativeInteger(value.total)
  ) {
    throw new RankingResponseError();
  }

  return {
    year: value.year,
    items: value.items.map((item) => ({ ...item })),
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
  };
}

export function parseRankingYears(value: unknown): RankingYears {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['years']) ||
    !Array.isArray(value.years) ||
    !value.years.every(
      (year) => typeof year === 'number' && Number.isInteger(year) && year >= 2000,
    )
  ) {
    throw new RankingResponseError();
  }
  return { years: value.years.map((year) => year) };
}

export async function getRanking(
  year: RankingYear,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<RankingPage> {
  const params = new URLSearchParams({
    year: String(year),
    page: String(page),
    pageSize: String(pageSize),
  });
  const response = await apiClient<unknown>(
    `ranking?${params.toString()}`,
    signal ? { signal } : undefined,
  );
  return parseRankingPage(response);
}

export async function getRankingYears(
  signal?: AbortSignal,
): Promise<readonly number[]> {
  const response = await apiClient<unknown>(
    'ranking/years',
    signal ? { signal } : undefined,
  );
  return parseRankingYears(response).years;
}
