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
} {
  const getPublicRankingMetrics = jest.fn<
    Promise<readonly CollectionPublicRankingMetricsDto[]>,
    [CollectionPublicRankingMetricsQueryDto]
  >();
  getPublicRankingMetrics.mockResolvedValue([]);
  const collection = {
    findRepositoryActivity: () => Promise.resolve([]),
    findRankingActivity: () => Promise.resolve([]),
    getStatusSnapshot: () => Promise.resolve(null),
    getRepositoryMetrics: () => Promise.resolve([]),
    getContributorMetrics: () => Promise.resolve([]),
    getPublicRankingMetrics,
  } satisfies CollectionReadPort;

  return {
    service: new RankingService(collection),
    getPublicRankingMetrics,
  };
}
