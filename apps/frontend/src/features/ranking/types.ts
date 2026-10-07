export const RANKING_YEAR_ALL = 'all' as const;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

export const RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

export type RankingPeriod =
  (typeof RANKING_PERIODS)[keyof typeof RANKING_PERIODS];

export const RANKING_VIEWER_CLASSES = {
  PUBLIC: 'public',
  MEMBER: 'member',
  STAFF: 'staff',
} as const;

export type RankingViewerClass =
  (typeof RANKING_VIEWER_CLASSES)[keyof typeof RANKING_VIEWER_CLASSES];

export interface PublicRankingItem {
  readonly rank: number;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
}

export interface MemberRankingItem extends PublicRankingItem {
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
}

export interface StaffRankingItem {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly department: string | null;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
}

export type RankingItem =
  PublicRankingItem | MemberRankingItem | StaffRankingItem;

interface RankingPageEnvelope {
  readonly year: RankingYear;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;

  readonly dataAsOf: Date | null;

  readonly nextCycleAt: string | null;
}

export interface PublicRankingPage extends RankingPageEnvelope {
  readonly viewerClass: typeof RANKING_VIEWER_CLASSES.PUBLIC;
  readonly items: readonly PublicRankingItem[];
}

export interface MemberRankingPage extends RankingPageEnvelope {
  readonly viewerClass: typeof RANKING_VIEWER_CLASSES.MEMBER;
  readonly items: readonly MemberRankingItem[];
}

export interface StaffRankingPage extends RankingPageEnvelope {
  readonly viewerClass: typeof RANKING_VIEWER_CLASSES.STAFF;
  readonly items: readonly StaffRankingItem[];
}

export type RankingPage =
  PublicRankingPage | MemberRankingPage | StaffRankingPage;

export interface RankingYears {
  readonly years: readonly number[];
}

export function currentRankingYear(now: Date = new Date()): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

export function rankingListHref(year: RankingYear): string {
  if (year === RANKING_YEAR_ALL) return '/ranking?year=all';
  return `/ranking?year=${year}`;
}

export function parseRankingYearSearchParam(
  raw: string | null | undefined,
): RankingYear {
  if (raw === null || raw === undefined || raw === '')
    return currentRankingYear();
  if (raw.toLowerCase() === RANKING_YEAR_ALL) return RANKING_YEAR_ALL;
  const year = Number(raw);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) return year;

  return currentRankingYear();
}
