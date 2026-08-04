import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
  CollectionReadPort,
} from '../collection/collection-read.port';

import { RankingService } from './ranking.service';

export function activity(
  githubId: bigint,
  githubLogin: string,
  commitCount: number,
  prCount: number,
  releaseCount: number,
): CollectionPublicRankingMetricsDto {
  return { githubId, githubLogin, commitCount, prCount, releaseCount };
}

export function setupRankingService(): {
  readonly service: RankingService;
  readonly getPublicRankingMetrics: jest.Mock<
    Promise<readonly CollectionPublicRankingMetricsDto[]>,
    [CollectionPublicRankingMetricsQueryDto]
  >;
  readonly listPublicRankingYears: jest.Mock<Promise<readonly number[]>, []>;
  readonly findEligibleGithubIds: jest.Mock<
    Promise<ReadonlySet<bigint>>,
    [readonly bigint[]]
  >;
  readonly findEligibleRepositoryIds: jest.Mock<Promise<readonly bigint[]>, []>;
} {
  const getPublicRankingMetrics = jest.fn<
    Promise<readonly CollectionPublicRankingMetricsDto[]>,
    [CollectionPublicRankingMetricsQueryDto]
  >();
  getPublicRankingMetrics.mockResolvedValue([]);
  const listPublicRankingYears = jest.fn<Promise<readonly number[]>, []>();
  listPublicRankingYears.mockResolvedValue([]);
  const collection = {
    findRepositoryActivity: () => Promise.resolve([]),
    findRankingActivity: () => Promise.resolve([]),
    getStatusSnapshot: () => Promise.resolve(null),
    getRepositoryMetrics: () => Promise.resolve([]),
    getContributorMetrics: () => Promise.resolve([]),
    getPublicRankingMetrics,
    listPublicRankingYears,
    getRepositoryCumulativeMetrics: () => Promise.resolve([]),
    getContributorCumulativeMetrics: () => Promise.resolve([]),
    getIncrementalStatusSnapshot: () =>
      Promise.resolve({
        trackedRepositoryCount: 0,
        readyStreamCount: 0,
        backfillingStreamCount: 0,
        partialStreamCount: 0,
        retryPendingStreamCount: 0,
        oldestReadyCheckpointAt: null,
        latestCheckpointAt: null,
        oldestRetryPendingAt: null,
        lastCycleStartedAt: null,
        lastCycleCompletedAt: null,
      }),
  } satisfies CollectionReadPort;

  const findEligibleGithubIds = jest.fn<
    Promise<ReadonlySet<bigint>>,
    [readonly bigint[]]
  >();
  findEligibleGithubIds.mockImplementation((githubIds) =>
    Promise.resolve(new Set(githubIds)),
  );
  const findEligibleRepositoryIds = jest.fn<Promise<readonly bigint[]>, []>();
  findEligibleRepositoryIds.mockResolvedValue([101n, 102n]);

  return {
    service: new RankingService(
      collection,
      { findEligibleRepositoryIds },
      { findEligibleGithubIds },
    ),
    getPublicRankingMetrics,
    listPublicRankingYears,
    findEligibleGithubIds,
    findEligibleRepositoryIds,
  };
}
