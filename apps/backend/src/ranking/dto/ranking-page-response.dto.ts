import type {
  RankingEntry,
  RankingPage,
  RankingViewerClass,
  RankingYear,
} from '../ranking.service';

class PublicRankingEntryResponseDto {
  declare readonly rank: number;
  declare readonly githubLogin: string;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;

  static from(entry: RankingEntry): PublicRankingEntryResponseDto {
    return {
      rank: entry.rank,
      githubLogin: entry.githubLogin,
      commitCount: entry.commitCount,
      pullRequestCount: entry.pullRequestCount,
    };
  }
}

class MemberRankingEntryResponseDto {
  declare readonly rank: number;
  declare readonly githubLogin: string;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly issueCount: number;
  declare readonly repositoryCount: number;
  declare readonly starCount: number;
  declare readonly total: number;

  static from(entry: RankingEntry): MemberRankingEntryResponseDto {
    return {
      rank: entry.rank,
      githubLogin: entry.githubLogin,
      commitCount: entry.commitCount,
      pullRequestCount: entry.pullRequestCount,
      issueCount: entry.issueCount,
      repositoryCount: entry.repositoryCount,
      starCount: entry.starCount,
      total: entry.total,
    };
  }
}

class StaffRankingEntryResponseDto {
  declare readonly rank: number;
  declare readonly displayName: string;
  declare readonly githubLogin: string;
  declare readonly department: string | null;
  declare readonly name: string | null;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly issueCount: number;
  declare readonly repositoryCount: number;
  declare readonly starCount: number;
  declare readonly total: number;

  static from(entry: RankingEntry): StaffRankingEntryResponseDto {
    return {
      rank: entry.rank,
      displayName: entry.displayName,
      githubLogin: entry.githubLogin,
      department: entry.department,
      name: entry.name ?? null,
      commitCount: entry.commitCount,
      pullRequestCount: entry.pullRequestCount,
      issueCount: entry.issueCount,
      repositoryCount: entry.repositoryCount,
      starCount: entry.starCount,
      total: entry.total,
    };
  }
}

type RankingEntryResponseDto =
  | PublicRankingEntryResponseDto
  | MemberRankingEntryResponseDto
  | StaffRankingEntryResponseDto;

function projectItems(page: RankingPage): readonly RankingEntryResponseDto[] {
  switch (page.viewerClass) {
    case 'public':
      return page.items.map((entry) =>
        PublicRankingEntryResponseDto.from(entry),
      );
    case 'member':
      return page.items.map((entry) =>
        MemberRankingEntryResponseDto.from(entry),
      );
    case 'staff':
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
  declare readonly year: RankingYear;
  declare readonly items: readonly RankingEntryResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly total: number;

  declare readonly dataAsOf: string | null;
  declare readonly viewerClass: RankingViewerClass;
  declare readonly nextCycleAt: string | null;

  static from(page: RankingPage): RankingPageResponseDto {
    return {
      year: page.year,
      items: projectItems(page),
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      dataAsOf: page.dataAsOf === null ? null : page.dataAsOf.toISOString(),
      viewerClass: page.viewerClass,
      nextCycleAt:
        page.nextCycleAt === null ? null : page.nextCycleAt.toISOString(),
    };
  }
}

export class RankingYearsResponseDto {
  declare readonly years: readonly number[];

  static from(years: readonly number[]): RankingYearsResponseDto {
    return { years };
  }
}
