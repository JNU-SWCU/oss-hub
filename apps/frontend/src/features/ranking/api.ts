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

/**
 * 필수 키는 전부 있어야 하고, 그 밖에는 허용 목록 안의 키만 올 수 있다.
 *
 * `hasExactKeys`와 달리 전이 구간을 허용하지만 **닫힌 세계는 유지한다** —
 * 목록에 없는 키가 하나라도 오면 거부한다. 봉투가 조용히 늘어나는 것을
 * 막는 것이 이 파서의 존재 이유이기 때문이다.
 */
function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const actualKeys = new Set(Object.keys(value));
  if (!required.every((key) => actualKeys.has(key))) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  return [...actualKeys].every((key) => allowed.has(key));
}

/**
 * PR 수 칸의 개명 전이.
 *
 * 백엔드는 `prCount` → `pullRequestCount` 로 개명하며, 그 사이 한 릴리스 동안
 * 두 이름이 공존할 수 있다. 파서는 **정확히 하나만** 받는다 —
 * 둘 다 오면 어느 쪽이 진실인지 알 수 없고, 둘 다 없으면 합계가 성립하지 않는다.
 *
 * 승격 순서는 셋이며 순서를 어기면 화면이 깨진다.
 *   1. (이 PR) 파서가 두 이름을 모두 받아들인다
 *   2. 백엔드가 `pullRequestCount` 로 바꿔 배포한다
 *   3. 파서가 `pullRequestCount` 를 required 로 올리고 `prCount` 를 뺀다
 * 2를 1보다 먼저 하면 그 순간 랭킹 화면이 죽는다.
 */
const PULL_REQUEST_COUNT_KEYS = ['prCount', 'pullRequestCount'] as const;

function readTransitionalPullRequestCount(
  value: Record<string, unknown>,
): number | null {
  const present = PULL_REQUEST_COUNT_KEYS.filter((key) =>
    Object.hasOwn(value, key),
  );
  if (present.length !== 1) {
    return null;
  }
  const raw = value[present[0]];
  return isNonNegativeInteger(raw) ? raw : null;
}

/** 갱신 시각 — ISO 문자열이거나 null 이거나, 아직 없을 수 있다(전이 구간). */
function isDataAsOf(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseRankingItem(value: unknown): RankingItem | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    !hasAllowedKeys(
      value,
      ['rank', 'displayName', 'githubLogin', 'commitCount', 'releaseCount', 'total'],
      [...PULL_REQUEST_COUNT_KEYS],
    )
  ) {
    return null;
  }

  const prCount = readTransitionalPullRequestCount(value);
  if (
    prCount === null ||
    !isPositiveInteger(value.rank) ||
    typeof value.displayName !== 'string' ||
    typeof value.githubLogin !== 'string' ||
    !isNonNegativeInteger(value.commitCount) ||
    !isNonNegativeInteger(value.releaseCount) ||
    !isNonNegativeInteger(value.total) ||
    value.total !== value.commitCount + prCount + value.releaseCount
  ) {
    return null;
  }

  // 내부 표현은 개명 전후와 무관하게 `prCount` 하나로 고정한다.
  return {
    rank: value.rank,
    displayName: value.displayName,
    githubLogin: value.githubLogin,
    commitCount: value.commitCount,
    prCount,
    releaseCount: value.releaseCount,
    total: value.total,
  };
}

export function parseRankingPage(value: unknown): RankingPage {
  if (
    !isRecord(value) ||
    // `dataAsOf` 는 백엔드 배포와 프런트 배포 사이에 없을 수 있으므로
    // 전이 구간에는 optional 로 둔다(ADR-010 §10). 두 배포가 끝나면 required 로 올린다.
    !hasAllowedKeys(
      value,
      ['year', 'items', 'page', 'pageSize', 'total'],
      ['dataAsOf'],
    ) ||
    !isDataAsOf(value.dataAsOf) ||
    !isRankingYear(value.year) ||
    !Array.isArray(value.items) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.pageSize) ||
    !isNonNegativeInteger(value.total)
  ) {
    throw new RankingResponseError();
  }

  const items = value.items.map(parseRankingItem);
  if (items.some((item) => item === null)) {
    throw new RankingResponseError();
  }

  return {
    year: value.year,
    items: items as readonly RankingItem[],
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
    dataAsOf:
      typeof value.dataAsOf === 'string' ? new Date(value.dataAsOf) : null,
  };
}

export function parseRankingYears(value: unknown): RankingYears {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['years']) ||
    !Array.isArray(value.years) ||
    !value.years.every(
      (year) =>
        typeof year === 'number' && Number.isInteger(year) && year >= 2000,
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
