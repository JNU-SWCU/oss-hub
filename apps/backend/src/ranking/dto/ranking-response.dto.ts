import {
  type RankingEntry,
  type RankingPage,
  type RankingYear,
} from '../domain/ranking';

/**
 * 공개 랭킹 항목 allowlist. 여기 적은 칸만 응답으로 나간다 — 실명은 없다.
 * `displayName`은 현행 계약이라 유지하고 항상 `githubLogin`과 같다(D3).
 */
class RankingEntryResponseDto {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly department: string | null;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;

  private constructor(entry: RankingEntry) {
    this.rank = entry.rank;
    this.displayName = entry.displayName;
    this.githubLogin = entry.githubLogin;
    this.department = entry.department;
    this.commitCount = entry.commitCount;
    this.pullRequestCount = entry.pullRequestCount;
    this.issueCount = entry.issueCount;
    this.repositoryCount = entry.repositoryCount;
    this.starCount = entry.starCount;
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
