import {
  RANKING_NOTICE,
  type RankingEntry,
  type RankingPage,
  type RankingPeriod,
} from '../domain/ranking';

class RankingEntryResponseDto {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly prCount: number;
  readonly starCount: number;
  readonly total: number;

  private constructor(entry: RankingEntry) {
    this.rank = entry.rank;
    this.displayName = entry.displayName;
    this.githubLogin = entry.githubLogin;
    this.commitCount = entry.commitCount;
    this.prCount = entry.prCount;
    this.starCount = entry.starCount;
    this.total = entry.total;
  }

  static from(entry: RankingEntry): RankingEntryResponseDto {
    return new RankingEntryResponseDto(entry);
  }
}

export class RankingPageResponseDto {
  readonly notice: typeof RANKING_NOTICE;
  readonly period: RankingPeriod;
  readonly items: readonly RankingEntryResponseDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;

  private constructor(page: RankingPage) {
    this.notice = page.notice;
    this.period = page.period;
    this.items = page.items.map((entry) => RankingEntryResponseDto.from(entry));
    this.page = page.page;
    this.pageSize = page.pageSize;
    this.total = page.total;
  }

  static from(page: RankingPage): RankingPageResponseDto {
    return new RankingPageResponseDto(page);
  }
}
