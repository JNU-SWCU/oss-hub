import type { RankingViewerClass } from './domain/ranking';
import type {
  RankingMetricRow,
  RankingRepository,
} from './repository/ranking.repository';
import { RankingService } from './service/ranking.service';

/**
 * One person-axis observation. Unspecified metrics are 0; department is null
 * unless set — tests only fill the fields they care about.
 */
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
  readonly findNextCycleAt: jest.Mock<Date | null, [Date]>;
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
  const findNextCycleAt = jest.fn<Date | null, [Date]>();
  findNextCycleAt.mockReturnValue(null);

  const ranking = {
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
    findNextCycleAt,
  } as unknown as RankingRepository;

  return {
    service: new RankingService(ranking),
    findMetrics,
    listYears,
    findDataAsOf,
    findViewerClass,
    findNamesByGithubIds,
    findNextCycleAt,
  };
}
