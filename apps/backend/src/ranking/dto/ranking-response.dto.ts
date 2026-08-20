import {
  type RankingEntry,
  type RankingPage,
  type RankingViewerClass,
  type RankingYear,
} from '../domain/ranking';

class RankingEntryResponseDto {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly department: string | null;
  /** Staff envelope only. Absent on public items — not `undefined`. */
  declare readonly name?: string | null;
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
    if ('name' in entry) {
      this.name = entry.name ?? null;
    }
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
  /** Observation time for these numbers. Null when nothing was observed. */
  readonly dataAsOf: string | null;
  readonly viewerClass: RankingViewerClass;
  readonly nextCycleAt: string | null;

  private constructor(page: RankingPage) {
    this.year = page.year;
    this.items = page.items.map((entry) => RankingEntryResponseDto.from(entry));
    this.page = page.page;
    this.pageSize = page.pageSize;
    this.total = page.total;
    this.dataAsOf = page.dataAsOf === null ? null : page.dataAsOf.toISOString();
    this.viewerClass = page.viewerClass;
    this.nextCycleAt =
      page.nextCycleAt === null ? null : page.nextCycleAt.toISOString();
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
