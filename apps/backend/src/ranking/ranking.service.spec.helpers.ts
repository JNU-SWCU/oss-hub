import type { CollectionScheduleService } from '../github/collection-schedule.service';
import type { RankingMetricRow, RankingRepository } from './ranking.repository';
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
  readonly findMetrics: jest.Mock<
    Promise<readonly RankingMetricRow[]>,
    [{ currentYear?: number }]
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
  const findMetrics = jest.fn<
    Promise<readonly RankingMetricRow[]>,
    [{ currentYear?: number }]
  >();
  findMetrics.mockResolvedValue([]);
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
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
  } as unknown as RankingRepository;

  return {
    service: new RankingService(
      ranking,
      new RankingYearService(),
      collectionSchedule,
    ),
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
    nextScheduledCollectionAt: nextScheduledAt,
  };
}
