import type { CollectionScheduleService } from '../github/collection-schedule.service';
import type {
  RankedPage,
  RankingMetricRow,
  RankingMetricsQuery,
  RankingRepository,
} from './ranking.repository';
import { RankingService, type RankingViewerClass } from './ranking.service';
import { RankingYearService } from './ranking-year.service';

const mockNextScheduledCollectionAt = jest.fn<
  ReturnType<CollectionScheduleService['nextScheduledCollectionAt']>,
  Parameters<CollectionScheduleService['nextScheduledCollectionAt']>
>();

const collectionSchedule = {
  nextScheduledCollectionAt: (from: Date) =>
    mockNextScheduledCollectionAt(from),
};

const nextScheduledAt = mockNextScheduledCollectionAt;

export function activity(
  githubId: bigint,
  githubLogin: string,
  metrics: Partial<{
    commitCount: number;
    pullRequestCount: number;
    issueCount: number;
    repositoryCount: number;
    starCount: number;
    department: string | null;
  }>,
): RankingMetricRow {
  return {
    githubId,
    githubLogin,
    department: metrics.department ?? null,
    commitCount: metrics.commitCount ?? 0,
    pullRequestCount: metrics.pullRequestCount ?? 0,
    issueCount: metrics.issueCount ?? 0,
    repositoryCount: metrics.repositoryCount ?? 0,
    starCount: metrics.starCount ?? 0,
  };
}

export function setupRankingService(): {
  readonly service: RankingService;
  readonly useRows: (rows: readonly RankingMetricRow[]) => void;
  readonly findRankedPage: jest.Mock<
    Promise<RankedPage>,
    [RankingMetricsQuery, { offset: number; limit: number }, Date]
  >;
  readonly listYears: jest.Mock<Promise<readonly number[]>, []>;
  readonly findDataAsOf: jest.Mock<Promise<Date | null>, []>;
  readonly findViewerClass: jest.Mock<
    Promise<RankingViewerClass>,
    [bigint | null]
  >;
  readonly findNamesByGithubIds: jest.Mock<
    Promise<ReadonlyMap<bigint, string | null>>,
    [readonly bigint[]]
  >;
  readonly nextScheduledCollectionAt: jest.MockedFunction<
    CollectionScheduleService['nextScheduledCollectionAt']
  >;
} {
  const rankingYear = new RankingYearService();
  let rows: readonly RankingMetricRow[] = [];
  const findRankedPage = jest.fn<
    Promise<RankedPage>,
    [RankingMetricsQuery, { offset: number; limit: number }, Date]
  >((_query, window) => {
    const ranked = rows
      .map((row) => ({ ...row, total: rankingYear.activityTotal(row) }))
      .sort((left, right) => rankingYear.compareRanked(left, right))
      .map((row, index) => ({ ...row, rank: index + 1, previousRank: null }));
    return Promise.resolve({
      rows: ranked.slice(window.offset, window.offset + window.limit),
      total: ranked.length,
    });
  });
  const listYears = jest.fn<Promise<readonly number[]>, []>();
  listYears.mockResolvedValue([]);
  const findDataAsOf = jest.fn<Promise<Date | null>, []>();
  findDataAsOf.mockResolvedValue(null);
  const findViewerClass = jest.fn<
    Promise<RankingViewerClass>,
    [bigint | null]
  >();
  findViewerClass.mockResolvedValue('public');
  const findNamesByGithubIds = jest.fn<
    Promise<ReadonlyMap<bigint, string | null>>,
    [readonly bigint[]]
  >();
  findNamesByGithubIds.mockResolvedValue(new Map());
  nextScheduledAt.mockReset().mockReturnValue(null);

  const ranking = {
    findRankedPage,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
  } as unknown as RankingRepository;

  return {
    service: new RankingService(ranking, rankingYear, collectionSchedule),
    useRows: (next) => {
      rows = next;
    },
    findRankedPage,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
    nextScheduledCollectionAt: nextScheduledAt,
  };
}
