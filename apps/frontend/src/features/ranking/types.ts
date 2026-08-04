/** Preferred ranking filter — calendar year or all-time. */
export const RANKING_YEAR_ALL = 'all' as const;

export type RankingYear = number | typeof RANKING_YEAR_ALL;

/**
 * Legacy period values (API `?period=`). Prefer `?year=`.
 * @deprecated
 */
export const RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

/** @deprecated Use RankingYear. */
export type RankingPeriod =
  (typeof RANKING_PERIODS)[keyof typeof RANKING_PERIODS];

export interface RankingItem {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly prCount: number;
  readonly releaseCount: number;
  readonly total: number;
}

export interface RankingPage {
  readonly year: RankingYear;
  readonly items: readonly RankingItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface RankingYears {
  readonly years: readonly number[];
}

/** Sidebar·deep-link. `all` → `/ranking`, else `?year=YYYY`. */
export function rankingListHref(year: RankingYear): string {
  if (year === RANKING_YEAR_ALL) return '/ranking';
  return `/ranking?year=${year}`;
}

/** Parse `?year=` — missing/invalid → all. */
export function parseRankingYearSearchParam(
  raw: string | null | undefined,
): RankingYear {
  if (raw === null || raw === undefined || raw === '') return RANKING_YEAR_ALL;
  if (raw.toLowerCase() === RANKING_YEAR_ALL) return RANKING_YEAR_ALL;
  const year = Number(raw);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) return year;
  return RANKING_YEAR_ALL;
}
