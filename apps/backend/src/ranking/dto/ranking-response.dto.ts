import {
  type RankingEntry,
  type RankingPage,
  type RankingYear,
} from '../domain/ranking';

class RankingEntryResponseDto {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
  readonly total: number;

  private constructor(entry: RankingEntry) {
    this.rank = entry.rank;
    this.displayName = entry.displayName;
    this.githubLogin = entry.githubLogin;
    this.commitCount = entry.commitCount;
    this.pullRequestCount = entry.pullRequestCount;
    this.releaseCount = entry.releaseCount;
    this.total = entry.total;
  }

  static from(entry: RankingEntry): RankingEntryResponseDto {
    return new RankingEntryResponseDto(entry);
  }
}

export class RankingPageResponseDto {
  readonly year: RankingYear;
  readonly items: readonly RankingEntryResponseDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** 이 수치의 기준 시각. 관측이 없으면 null (ADR-010 §10). */
  readonly dataAsOf: string | null;

  private constructor(page: RankingPage) {
    this.year = page.year;
    this.items = page.items.map((entry) => RankingEntryResponseDto.from(entry));
    this.page = page.page;
    this.pageSize = page.pageSize;
    this.total = page.total;
    this.dataAsOf = page.dataAsOf === null ? null : page.dataAsOf.toISOString();
  }

  static from(page: RankingPage): RankingPageResponseDto {
    return new RankingPageResponseDto(page);
  }
}

export class RankingYearsResponseDto {
  readonly years: readonly number[];

  private constructor(years: readonly number[]) {
    this.years = years;
  }

  static from(years: readonly number[]): RankingYearsResponseDto {
    return new RankingYearsResponseDto(years);
  }
}
