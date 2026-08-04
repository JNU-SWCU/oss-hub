import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
  CollectionReadPort,
} from '../collection/collection-read.port';
import type {
  UserDisplayName,
  UserDisplayNameRepository,
} from '../users/user-display-name.repository';
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
  readonly findByGithubIds: jest.Mock<
    Promise<readonly UserDisplayName[]>,
    [readonly bigint[]]
  >;
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

  const findByGithubIds = jest.fn<
    Promise<readonly UserDisplayName[]>,
    [readonly bigint[]]
  >();
  findByGithubIds.mockResolvedValue([]);
  const displayNameRepository = {
    findByGithubIds,
  } as unknown as UserDisplayNameRepository;

  return {
    service: new RankingService(collection, displayNameRepository),
    getPublicRankingMetrics,
    listPublicRankingYears,
    findByGithubIds,
  };
}
