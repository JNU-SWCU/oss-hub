export const RANKING_PERIODS = {
  THIS_YEAR: 'THIS_YEAR',
  ALL: 'ALL',
} as const;

export type RankingPeriod =
  (typeof RANKING_PERIODS)[keyof typeof RANKING_PERIODS];

export const RANKING_NOTICE =
  '본 랭킹은 공개 GitHub 활동량 집계이며 평가·시상과 무관합니다.';

export interface RankingItem {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly prCount: number;
  readonly starCount: number;
  readonly total: number;
}

export interface RankingPage {
  readonly notice: typeof RANKING_NOTICE;
  readonly period: RankingPeriod;
  readonly items: readonly RankingItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}
