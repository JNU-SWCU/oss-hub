import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
  CollectionReadPort,
} from '../github/collection-read.port';
import type {
  UserDisplayName,
  UserDisplayNameRepository,
} from '../users/user-display-name.repository';
import {
  RANKING_VIEWER_TIERS,
  type RankingViewerTier,
} from './domain/ranking';
import type { RankingViewerRepository } from './repository/ranking-viewer.repository';
import { RankingService } from './service/ranking.service';

/**
 * 사람 축 관측 한 행. 지정하지 않은 지표는 0이고 학과는 null 이다 — 테스트가
 * 관심 있는 칸만 적게 한다.
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
    /** 교직원·관리자 계층이 물었을 때만 repository 가 채워 주는 칸. */
    realName: string | null;
  }> = {},
): CollectionPublicRankingMetricsDto {
  return {
    githubId,
    githubLogin,
    department: metrics.department ?? null,
    ...('realName' in metrics ? { realName: metrics.realName ?? null } : {}),
    commitCount: metrics.commitCount ?? 0,
    pullRequestCount: metrics.pullRequestCount ?? 0,
    issueCount: metrics.issueCount ?? 0,
    repositoryCount: metrics.repositoryCount ?? 0,
    starCount: metrics.starCount ?? 0,
  };
}

export function setupRankingService(): {
  readonly service: RankingService;
  readonly getPublicRankingMetrics: jest.Mock<
    Promise<readonly CollectionPublicRankingMetricsDto[]>,
    [CollectionPublicRankingMetricsQueryDto]
  >;
  readonly listPublicRankingYears: jest.Mock<Promise<readonly number[]>, []>;
  readonly getPublicRankingDataAsOf: jest.Mock<Promise<Date | null>, []>;
  readonly findByGithubIds: jest.Mock<
    Promise<readonly UserDisplayName[]>,
    [readonly bigint[]]
  >;
  /** 세션 githubId → 계층. 기본은 공개 계층이다. */
  readonly findTier: jest.Mock<
    Promise<RankingViewerTier>,
    [bigint | null]
  >;
} {
  const getPublicRankingMetrics = jest.fn<
    Promise<readonly CollectionPublicRankingMetricsDto[]>,
    [CollectionPublicRankingMetricsQueryDto]
  >();
  getPublicRankingMetrics.mockResolvedValue([]);
  const listPublicRankingYears = jest.fn<Promise<readonly number[]>, []>();
  listPublicRankingYears.mockResolvedValue([]);
  const getPublicRankingDataAsOf = jest.fn<Promise<Date | null>, []>();
  getPublicRankingDataAsOf.mockResolvedValue(null);
  const collection = {
    findRepositoryActivity: () => Promise.resolve([]),
    findRankingActivity: () => Promise.resolve([]),
    getStatusSnapshot: () => Promise.resolve(null),
    getRepositoryMetrics: () => Promise.resolve([]),
    getContributorMetrics: () => Promise.resolve([]),
    getPublicRankingMetrics,
    listPublicRankingYears,
    getPublicRankingDataAsOf,
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
        dueRepositoryCount: 0,
        failingRepositoryCount: 0,
        lastRepositorySuccessAt: null,
      }),
    getIncrementalStatusStreams: () => Promise.resolve([]),
    getNextScheduledCycleAt: () => Promise.resolve(null),
    getRecentSweepActivity: () => Promise.resolve([]),
    getExternalCollectionStatus: () =>
      Promise.resolve({
        trackedRepositoryCount: 0,
        lastSweep: null,
        cumulativeCommitCount: 0,
        cumulativePullRequestCount: 0,
        cumulativeReleaseCount: 0,
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

  const findTier = jest.fn<Promise<RankingViewerTier>, [bigint | null]>();
  findTier.mockResolvedValue(RANKING_VIEWER_TIERS.PUBLIC);
  const viewerRepository = {
    findTier,
  } as unknown as RankingViewerRepository;

  return {
    service: new RankingService(
      collection,
      displayNameRepository,
      viewerRepository,
    ),
    getPublicRankingMetrics,
    listPublicRankingYears,
    getPublicRankingDataAsOf,
    findByGithubIds,
    findTier,
  };
}
