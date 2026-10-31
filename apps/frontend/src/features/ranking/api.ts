import { apiClient } from '@/lib/api-client';
import { isRecord } from '@/lib/is-record';
import {
  RANKING_VIEWER_CLASSES,
  RANKING_YEAR_ALL,
  type PublicRankingItem,
  type RankingPage,
  type RankingTimeline,
  type RankingTimelinePoint,
  type RankingTimelineSeries,
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCalendarYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000;
}

function isRankingYear(value: unknown): value is RankingYear {
  if (value === RANKING_YEAR_ALL) return true;
  return isCalendarYear(value);
}

function readOptionalCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return isNonNegativeInteger(value) ? value : null;
}

function readOptionalDepartment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isOptionalIsoInstant(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isViewerClass(value: unknown): value is RankingViewerClass {
  return (
    value === RANKING_VIEWER_CLASSES.PUBLIC ||
    value === RANKING_VIEWER_CLASSES.MEMBER ||
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

  const issueCount = readOptionalCount(value.issueCount);
  const repositoryCount = readOptionalCount(value.repositoryCount);
  const starCount = readOptionalCount(value.starCount);
  const total = readOptionalCount(value.total);
  if (
    issueCount === null ||
    repositoryCount === null ||
    starCount === null ||
    total === null
  ) {
    return null;
  }

  return {
    rank: value.rank,
    githubLogin: value.githubLogin,
    commitCount: value.commitCount,
    pullRequestCount: value.pullRequestCount,
    issueCount,
    repositoryCount,
    starCount,
    total,
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
  if (viewerClass === RANKING_VIEWER_CLASSES.STAFF) {
    return {
      ...envelope,
      viewerClass,
      items: parseRankingItems(value.items, parseStaffRankingItem),
    };
  }
  return {
    ...envelope,
    viewerClass,
    items: parseRankingItems(value.items, parsePublicRankingItem),
  };
}

export function parseRankingYears(value: unknown): RankingYears {
  if (!isRecord(value) || !Array.isArray(value.years)) {
    throw new RankingResponseError();
  }
  const years: readonly unknown[] = value.years;
  if (!years.every(isCalendarYear)) {
    throw new RankingResponseError();
  }
  return { years };
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = CALENDAR_DATE_PATTERN.exec(value);
  if (parts === null) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === Number(parts[1]) &&
    parsed.getUTCMonth() + 1 === Number(parts[2]) &&
    parsed.getUTCDate() === Number(parts[3])
  );
}

function isOptionalGithubLogin(
  value: unknown,
): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function parseTimelinePoint(value: unknown): RankingTimelinePoint | null {
  if (!isRecord(value) || !isCalendarDate(value.date)) {
    return null;
  }
  return { date: value.date };
}

function readAlignedValues(
  value: unknown,
  pointCount: number,
  isAllowed: (candidate: unknown) => candidate is number,
): readonly (number | null)[] | null {
  if (!Array.isArray(value) || value.length !== pointCount) return null;
  const values: (number | null)[] = [];
  for (const entry of value) {
    if (entry === null) {
      values.push(null);
      continue;
    }
    if (!isAllowed(entry)) return null;
    values.push(entry);
  }
  return values;
}

function parseTimelineSeries(
  value: unknown,
  pointCount: number,
): RankingTimelineSeries | null {
  if (!isRecord(value) || typeof value.githubLogin !== 'string') {
    return null;
  }

  const ranks = readAlignedValues(value.ranks, pointCount, isPositiveInteger);
  const totals = readAlignedValues(
    value.totals,
    pointCount,
    isNonNegativeInteger,
  );
  if (ranks === null || totals === null) return null;

  return { githubLogin: value.githubLogin, ranks, totals };
}

export function parseRankingTimeline(value: unknown): RankingTimeline {
  if (
    !isRecord(value) ||
    !isCalendarYear(value.year) ||
    !isOptionalGithubLogin(value.viewerGithubLogin) ||
    !isOptionalIsoInstant(value.dataAsOf) ||
    !Array.isArray(value.points) ||
    !Array.isArray(value.series)
  ) {
    throw new RankingResponseError();
  }

  const viewerClass = value.viewerClass;
  if (!isViewerClass(viewerClass)) {
    throw new RankingResponseError();
  }

  const points = parseRankingItems(value.points, parseTimelinePoint);
  const series = parseRankingItems(value.series, (rawSeries) =>
    parseTimelineSeries(rawSeries, points.length),
  );

  return {
    year: value.year,
    viewerClass,
    viewerGithubLogin:
      typeof value.viewerGithubLogin === 'string'
        ? value.viewerGithubLogin
        : null,
    dataAsOf:
      typeof value.dataAsOf === 'string' ? new Date(value.dataAsOf) : null,
    points,
    series,
  };
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

export async function getRankingTimeline(
  year: number,
  signal?: AbortSignal,
): Promise<RankingTimeline> {
  const params = new URLSearchParams({ year: String(year) });
  const response = await apiClient<unknown>(
    `ranking/timeline?${params.toString()}`,
    signal ? { signal } : undefined,
  );
  return parseRankingTimeline(response);
}
