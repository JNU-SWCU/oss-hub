import {
  RANKING_VIEWER_CLASSES,
  type RankingEntry,
  type RankingPage,
  type RankingViewerClass,
  type RankingYear,
} from '../domain/ranking';

/**
 * 비로그인 투영 — 순위·참여자·Commit·PR 네 칸뿐이다.
 * Issue·Repo·Star·합계는 구성원 계층부터다.
 */
class PublicRankingEntryResponseDto {
  readonly rank: number;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;

  private constructor(entry: RankingEntry) {
    this.rank = entry.rank;
    this.githubLogin = entry.githubLogin;
    this.commitCount = entry.commitCount;
    this.pullRequestCount = entry.pullRequestCount;
  }

  static from(entry: RankingEntry): PublicRankingEntryResponseDto {
    return new PublicRankingEntryResponseDto(entry);
  }
}

/** 로그인 구성원 투영 — 지표 전부. 신원(이름·학과)은 여전히 빠진다. */
class MemberRankingEntryResponseDto {
  readonly rank: number;
  readonly githubLogin: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly issueCount: number;
  readonly repositoryCount: number;
  readonly starCount: number;
  readonly total: number;

  private constructor(entry: RankingEntry) {
    this.rank = entry.rank;
    this.githubLogin = entry.githubLogin;
    this.commitCount = entry.commitCount;
    this.pullRequestCount = entry.pullRequestCount;
    this.issueCount = entry.issueCount;
    this.repositoryCount = entry.repositoryCount;
    this.starCount = entry.starCount;
    this.total = entry.total;
  }

  static from(entry: RankingEntry): MemberRankingEntryResponseDto {
    return new MemberRankingEntryResponseDto(entry);
  }
}

class StaffRankingEntryResponseDto {
  readonly rank: number;
  readonly displayName: string;
  readonly githubLogin: string;
  readonly department: string | null;
  readonly name: string | null;
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
    this.name = entry.name ?? null;
  }

  static from(entry: RankingEntry): StaffRankingEntryResponseDto {
    return new StaffRankingEntryResponseDto(entry);
  }
}

type RankingEntryResponseDto =
  | PublicRankingEntryResponseDto
  | MemberRankingEntryResponseDto
  | StaffRankingEntryResponseDto;

/** 계층 하나에 투영 하나. 계층이 늘면 여기서 컴파일이 깨져야 한다. */
function projectItems(page: RankingPage): readonly RankingEntryResponseDto[] {
  switch (page.viewerClass) {
    case RANKING_VIEWER_CLASSES.PUBLIC:
      return page.items.map((entry) =>
        PublicRankingEntryResponseDto.from(entry),
      );
    case RANKING_VIEWER_CLASSES.MEMBER:
      return page.items.map((entry) =>
        MemberRankingEntryResponseDto.from(entry),
      );
    case RANKING_VIEWER_CLASSES.STAFF:
      return page.items.map((entry) =>
        StaffRankingEntryResponseDto.from(entry),
      );
    default:
      return assertNeverViewerClass(page.viewerClass);
  }
}

function assertNeverViewerClass(value: never): never {
  throw new TypeError(`Unexpected ranking viewer class: ${String(value)}`);
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
    this.items = projectItems(page);
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
