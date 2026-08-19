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

/**
 * 없으면 0, 있으면 형이 맞아야 한다.
 *
 * 지표 칸은 화면이 숫자로 그리는 값이라 문자열이 오면 조용히 깨진다. 반대로
 * 아직 내려오지 않는 칸은 0으로 두면 화면이 성립한다 — 백엔드가 지표를
 * 늘리거나 줄이는 동안 랭킹 화면이 통째로 죽지 않게 하는 것이 이 기본값이다.
 */
function readOptionalCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return isNonNegativeInteger(value) ? value : null;
}

/** 갱신 시각 — ISO 문자열이거나 null 이거나, 아직 없을 수 있다. */
function isDataAsOf(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * 관용적 읽기(tolerant reader).
 *
 * **모르는 필드는 무시한다** — 봉투에 새 칸이 늘어나는 것은 백엔드가 앞서
 * 배포됐다는 뜻이지 응답이 틀렸다는 뜻이 아니다. 예전 파서는 키 목록을
 * 닫아 두고 목록 밖 키가 하나만 와도 페이지 전체를 거부해서, 백엔드가 칸을
 * 하나 더 붙이는 순간 랭킹 화면이 통째로 죽었다.
 *
 * 검사하는 것은 **화면이 실제로 쓰는 값**뿐이다. `total` 은 백엔드가 정한
 * 합계를 그대로 싣는다 — 여기서 지표를 다시 더해 검산하면 프런트가 백엔드
 * 판정을 재현하게 되고(ADR-008), 지표 구성이 바뀔 때마다 화면이 먼저 깨진다.
 */
function parseRankingItem(value: unknown): RankingItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const commitCount = readOptionalCount(value.commitCount);
  const pullRequestCount = readOptionalCount(value.pullRequestCount);
  const issueCount = readOptionalCount(value.issueCount);
  const repositoryCount = readOptionalCount(value.repositoryCount);
  const starCount = readOptionalCount(value.starCount);
  if (
    !isPositiveInteger(value.rank) ||
    typeof value.githubLogin !== 'string' ||
    !isNonNegativeInteger(value.total) ||
    commitCount === null ||
    pullRequestCount === null ||
    issueCount === null ||
    repositoryCount === null ||
    starCount === null
  ) {
    return null;
  }

  return {
    rank: value.rank,
    // 표시 이름은 없으면 GitHub 로그인으로 대신한다 — 사람을 못 알아보는
    // 행보다 로그인으로라도 보이는 행이 낫다.
    displayName:
      typeof value.displayName === 'string'
        ? value.displayName
        : value.githubLogin,
    githubLogin: value.githubLogin,
    commitCount,
    pullRequestCount,
    issueCount,
    repositoryCount,
    starCount,
    total: value.total,
  };
}

export function parseRankingPage(value: unknown): RankingPage {
  if (
    !isRecord(value) ||
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
