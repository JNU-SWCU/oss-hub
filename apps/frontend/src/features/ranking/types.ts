export const RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

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
  readonly period: RankingPeriod;
  readonly items: readonly RankingItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}
