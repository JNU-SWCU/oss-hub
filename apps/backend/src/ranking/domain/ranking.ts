import { rankingYearInAsiaSeoul } from './ranking-event';

/** Preferred filter — calendar year or all-time. */
export const RANKING_YEAR_ALL = 'all' as const;

/** Inclusive calendar-year bounds for `?year=` (single source for DTO + parse). */
export const RANKING_YEAR_MIN = 2000;
export const RANKING_YEAR_MAX = 2100;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

/**
 * Legacy query values (`?period=`). Prefer `?year=` — mapped in
 * `resolveRankingYearFromQuery`.
 */
export const LEGACY_RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

export type LegacyRankingPeriod =
  (typeof LEGACY_RANKING_PERIODS)[keyof typeof LEGACY_RANKING_PERIODS];

/** @deprecated Use `RANKING_YEAR_ALL` / numeric years. Kept for call-site migration. */
export const RANKING_PERIODS = LEGACY_RANKING_PERIODS;

/** @deprecated Use `RankingYear`. */
export type RankingPeriod = LegacyRankingPeriod;

export interface RankingMetrics {
  readonly commitCount: number;
  readonly prCount: number;
  readonly releaseCount: number;
}

export interface RankingEntry extends RankingMetrics {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * Resolve ranking scope from preferred `year` or legacy `period`.
 * Default when neither is set: all-time (`all`).
 */
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
  return RANKING_YEAR_ALL;
}
