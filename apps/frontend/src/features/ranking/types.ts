export const RANKING_YEAR_ALL = 'all' as const;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

export const RANKING_VIEWER_CLASSES = {
  PUBLIC: 'public',
  MEMBER: 'member',
  STAFF: 'staff',
} as const;

export type RankingViewerClass =
  (typeof RANKING_VIEWER_CLASSES)[keyof typeof RANKING_VIEWER_CLASSES];

export interface PublicRankingItem {
  readonly rank: number;
  readonly previousRank: number | null;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;
}

export interface StaffRankingItem {
  readonly rank: number;
  readonly previousRank: number | null;
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

interface MemberRankingPage extends RankingPageEnvelope {
  readonly viewerClass: typeof RANKING_VIEWER_CLASSES.MEMBER;
  readonly items: readonly PublicRankingItem[];
}

export interface StaffRankingPage extends RankingPageEnvelope {
  readonly viewerClass: typeof RANKING_VIEWER_CLASSES.STAFF;
  readonly items: readonly StaffRankingItem[];
}

export type RankingPage =
  PublicRankingPage | MemberRankingPage | StaffRankingPage;

export interface RankingTimelineSeries {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];
  readonly totals: readonly (number | null)[];
}

interface RankingYearTimeline {
  readonly year: number;
  readonly months: readonly number[];
  readonly series: readonly RankingTimelineSeries[];
}

interface RankingTimelinePeriod {
  readonly fromMonth: string;
  readonly toMonth: string;
}

interface RankingAllTimeline {
  readonly year: typeof RANKING_YEAR_ALL;
  readonly periods: readonly RankingTimelinePeriod[];
  readonly series: readonly RankingTimelineSeries[];
}

export type RankingTimeline = RankingYearTimeline | RankingAllTimeline;

export interface RankingYears {
  readonly years: readonly number[];
}

export function currentRankingYear(now: Date = new Date()): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

export function rankingListHref(year: RankingYear, search = ''): string {
  const params = new URLSearchParams(search);
  params.delete('page');
  if (year === RANKING_YEAR_ALL) params.delete('year');
  else params.set('year', String(year));
  const query = params.toString();
  return query ? `/ranking?${query}` : '/ranking';
}

export function parseRankingYearSearchParam(
  raw: string | null | undefined,
): RankingYear {
  return raw && /^(20\d{2}|2100)$/.test(raw) ? Number(raw) : RANKING_YEAR_ALL;
}
