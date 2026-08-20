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

export const RANKING_VIEWER_CLASSES = {
  PUBLIC: 'public',
  STAFF: 'staff',
} as const;

export type RankingViewerClass =
  (typeof RANKING_VIEWER_CLASSES)[keyof typeof RANKING_VIEWER_CLASSES];

/**
 * Person-axis ranking metrics (admin request — star/repo/issue instead of release).
 * `starCount` is the account's cumulative public-repo stars — GitHub does not
 * split stars by year. Release stays on the repository axis (program surface).
 */
export interface RankingMetrics {
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
}

/** Public metrics row before rank/name are attached. */
export interface RankingActivity extends RankingMetrics {
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly department: string | null;
}

export interface RankingEntry extends RankingMetrics {
  readonly rank: number;
  /** Always `githubLogin`. Staff real names live on optional `name`. */
  readonly displayName: string;
  readonly githubLogin: string;
  readonly department: string | null;
  /** Staff envelope only. Public items omit this key. */
  readonly name?: string | null;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /**
   * When these numbers were observed (ADR-010 §10).
   * Null when no person-axis observation exists.
   */
  readonly dataAsOf: Date | null;
  readonly viewerClass: RankingViewerClass;
  readonly nextCycleAt: Date | null;
}

/**
 * Resolve ranking scope from preferred `year` or legacy `period`.
 * Default when neither is set: Asia/Seoul calendar year.
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
  return rankingYearInAsiaSeoul(now);
}
