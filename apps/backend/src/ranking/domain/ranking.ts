import { rankingYearInAsiaSeoul } from './ranking-event';

export const RANKING_YEAR_ALL = 'all' as const;

export const RANKING_YEAR_MIN = 2000;
export const RANKING_YEAR_MAX = 2100;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

export const LEGACY_RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

export type LegacyRankingPeriod =
  (typeof LEGACY_RANKING_PERIODS)[keyof typeof LEGACY_RANKING_PERIODS];

export const RANKING_PERIODS = LEGACY_RANKING_PERIODS;

export type RankingPeriod = LegacyRankingPeriod;

export const RANKING_VIEWER_CLASSES = {
  PUBLIC: 'public',
  MEMBER: 'member',
  STAFF: 'staff',
} as const;

export type RankingViewerClass =
  (typeof RANKING_VIEWER_CLASSES)[keyof typeof RANKING_VIEWER_CLASSES];

export interface RankingMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

export interface RankingActivity extends RankingMetrics {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly department: string | null;
}

export interface RankingEntry extends RankingMetrics {
  readonly rank: number;

  readonly displayName: string;
  readonly githubLogin: string;
  readonly department: string | null;

  readonly name?: string | null;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;

  readonly dataAsOf: Date | null;
  readonly viewerClass: RankingViewerClass;
  readonly nextCycleAt: Date | null;
}

export function resolveRankingYearFromQuery(
  year: RankingYear | undefined,
  period: LegacyRankingPeriod | undefined,
  now: Date = new Date(),
): RankingYear {
  if (year !== undefined) return year;
  if (period === LEGACY_RANKING_PERIODS.THIS_YEAR) {
    return rankingYearInAsiaSeoul(now);
  }
  if (period === LEGACY_RANKING_PERIODS.ALL) return RANKING_YEAR_ALL;
  return rankingYearInAsiaSeoul(now);
}
