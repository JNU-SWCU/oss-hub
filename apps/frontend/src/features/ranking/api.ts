import { apiClient } from '@/lib/api-client';
import {
  RANKING_VIEWER_CLASSES,
  RANKING_YEAR_ALL,
  type PublicRankingItem,
  type RankingPage,
  type RankingViewerClass,
  type RankingYear,
  type RankingYears,
  type StaffRankingItem,
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

/**
 * 학과 — 없을 수도, null 일 수도 있다.
 *
 * 화면이 자리를 대시로 채우면 성립하는 값이라 형이 어긋나도 페이지를 버리지
 * 않는다. 빈 문자열은 값이 없는 것과 같게 다뤄 화면에 빈칸이 남지 않게 한다.
 */
function readOptionalDepartment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Observation time — ISO string, null, or omitted. */
function isOptionalIsoInstant(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isViewerClass(value: unknown): value is RankingViewerClass {
  return (
    value === RANKING_VIEWER_CLASSES.PUBLIC ||
    value === RANKING_VIEWER_CLASSES.STAFF
  );
}

function readOptionalName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 관용적 읽기(tolerant reader).
 *
 * **모르는 필드는 무시한다** — 봉투에 새 칸이 늘어나는 것은 백엔드가 앞서
 * 배포됐다는 뜻이지 응답이 틀렸다는 뜻이 아니다. 예전 파서는 키 목록을
 * 닫아 두고 목록 밖 키가 하나만 와도 페이지 전체를 거부해서, 백엔드가 칸을
 * 하나 더 붙이는 순간 랭킹 화면이 통째로 죽었다.
 *
 * Public items retain only the consent-aligned four-key projection. Staff
 * items keep the richer operational fields and tolerate omitted legacy
 * optional metrics as zero.
 */
function parsePublicRankingItem(value: unknown): PublicRankingItem | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    'name' in value ||
    !isPositiveInteger(value.rank) ||
    typeof value.githubLogin !== 'string' ||
    !isNonNegativeInteger(value.commitCount) ||
    !isNonNegativeInteger(value.pullRequestCount)
  ) {
    return null;
  }

  return {
    rank: value.rank,
    githubLogin: value.githubLogin,
    commitCount: value.commitCount,
    pullRequestCount: value.pullRequestCount,
  };
}

function parseStaffRankingItem(value: unknown): StaffRankingItem | null {
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

  if (
    'name' in value &&
    value.name !== null &&
    typeof value.name !== 'string'
  ) {
    return null;
  }

  return {
    rank: value.rank,
    displayName:
      typeof value.displayName === 'string'
        ? value.displayName
        : value.githubLogin,
    githubLogin: value.githubLogin,
    department: readOptionalDepartment(value.department),
    commitCount,
    pullRequestCount,
    issueCount,
    repositoryCount,
    starCount,
    total: value.total,
    name: readOptionalName(value.name) ?? null,
  };
}

function parseRankingItems<T>(
  values: readonly unknown[],
  parseItem: (value: unknown) => T | null,
): readonly T[] {
  const items: T[] = [];
  for (const rawItem of values) {
    const item = parseItem(rawItem);
    if (item === null) {
      throw new RankingResponseError();
    }
    items.push(item);
  }
  return items;
}

export function parseRankingPage(value: unknown): RankingPage {
  if (
    !isRecord(value) ||
    !isOptionalIsoInstant(value.dataAsOf) ||
    !isOptionalIsoInstant(value.nextCycleAt) ||
    !isRankingYear(value.year) ||
    !Array.isArray(value.items) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.pageSize) ||
    !isNonNegativeInteger(value.total)
  ) {
    throw new RankingResponseError();
  }

  const viewerClass = value.viewerClass;
  if (!isViewerClass(viewerClass)) {
    throw new RankingResponseError();
  }

  const envelope = {
    year: value.year,
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
    dataAsOf:
      typeof value.dataAsOf === 'string' ? new Date(value.dataAsOf) : null,
    nextCycleAt:
      typeof value.nextCycleAt === 'string' ? value.nextCycleAt : null,
  };
  switch (viewerClass) {
    case RANKING_VIEWER_CLASSES.PUBLIC:
      return {
        ...envelope,
        viewerClass,
        items: parseRankingItems(value.items, parsePublicRankingItem),
      };
    case RANKING_VIEWER_CLASSES.STAFF:
      return {
        ...envelope,
        viewerClass,
        items: parseRankingItems(value.items, parseStaffRankingItem),
      };
    default:
      return assertNeverViewerClass(viewerClass);
  }
}

function assertNeverViewerClass(value: never): never {
  throw new TypeError(`Unexpected ranking viewer class: ${String(value)}`);
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
