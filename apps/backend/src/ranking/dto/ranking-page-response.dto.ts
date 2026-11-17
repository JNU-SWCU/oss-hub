import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import type {
  RankingEntry,
  RankingPage,
  RankingViewerClass,
} from '../ranking.service';
import type { RankingYear } from '../ranking-year.service';
import type {
  RankingTimeline,
  RankingTimelineSeries,
} from '../ranking-timeline.service';

const NULLABLE_INTEGER_ARRAY = {
  type: 'array',
  items: { type: 'integer', nullable: true },
} as const;

class PublicRankingEntryResponseDto {
  declare readonly rank: number;
  declare readonly previousRank: number | null;
  declare readonly githubLogin: string;
  declare readonly commitCount: number;
  declare readonly pullRequestCount: number;
  declare readonly issueCount: number;
  declare readonly repositoryCount: number;
  declare readonly starCount: number;
  declare readonly total: number;

  static from(entry: RankingEntry): PublicRankingEntryResponseDto {
    return {
      rank: entry.rank,
      previousRank: entry.previousRank,
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
  declare readonly previousRank: number | null;
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
      previousRank: entry.previousRank,
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
  PublicRankingEntryResponseDto | StaffRankingEntryResponseDto;

function projectItems(page: RankingPage): readonly RankingEntryResponseDto[] {
  switch (page.viewerClass) {
    case 'public':
    case 'member':
      return page.items.map((entry) =>
        PublicRankingEntryResponseDto.from(entry),
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

@ApiExtraModels(PublicRankingEntryResponseDto, StaffRankingEntryResponseDto)
export class RankingPageResponseDto {
  @ApiProperty({
    oneOf: [{ type: 'integer' }, { type: 'string', enum: ['all'] }],
  })
  declare readonly year: RankingYear;
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(PublicRankingEntryResponseDto) },
        { $ref: getSchemaPath(StaffRankingEntryResponseDto) },
      ],
    },
  })
  declare readonly items: RankingEntryResponseDto[];
  declare readonly page: number;
  declare readonly pageSize: number;
  declare readonly total: number;

  declare readonly dataAsOf: string | null;
  declare readonly viewerClass: RankingViewerClass;
  declare readonly nextCycleAt: string | null;

  static from(page: RankingPage): RankingPageResponseDto {
    return {
      year: page.year,
      items: [...projectItems(page)],
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
  declare readonly years: number[];

  static from(years: readonly number[]): RankingYearsResponseDto {
    return { years: [...years] };
  }
}

class RankingTimelineSeriesResponseDto {
  declare readonly githubLogin: string;
  @ApiProperty(NULLABLE_INTEGER_ARRAY)
  declare readonly ranks: (number | null)[];
  @ApiProperty(NULLABLE_INTEGER_ARRAY)
  declare readonly totals: (number | null)[];

  static from(series: RankingTimelineSeries): RankingTimelineSeriesResponseDto {
    return {
      githubLogin: series.githubLogin,
      ranks: [...series.ranks],
      totals: [...series.totals],
    };
  }
}

export class RankingTimelineResponseDto {
  declare readonly year: number;
  declare readonly months: number[];
  declare readonly series: RankingTimelineSeriesResponseDto[];

  static from(timeline: RankingTimeline): RankingTimelineResponseDto {
    return {
      year: timeline.year,
      months: [...timeline.months],
      series: timeline.series.map((series) =>
        RankingTimelineSeriesResponseDto.from(series),
      ),
    };
  }
}
