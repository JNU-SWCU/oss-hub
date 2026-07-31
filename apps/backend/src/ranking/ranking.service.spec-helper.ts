import type {
  CollectionRankingActivityDto,
  CollectionRankingActivityQueryDto,
  CollectionReadPort,
} from '../collection/collection-read.port';
import { RankingService } from './ranking.service';

export function activity(
  githubId: bigint,
  githubLogin: string,
  commitCount: number,
  prCount: number,
  releaseCount: number,
): CollectionRankingActivityDto {
  return { githubId, githubLogin, commitCount, prCount, releaseCount };
}

export function setupRankingService(): {
  readonly service: RankingService;
  readonly findRankingActivity: jest.Mock<
    Promise<readonly CollectionRankingActivityDto[]>,
    [CollectionRankingActivityQueryDto]
  >;
} {
  const findRankingActivity = jest.fn<
    Promise<readonly CollectionRankingActivityDto[]>,
    [CollectionRankingActivityQueryDto]
  >();
  findRankingActivity.mockResolvedValue([]);
  const collection = {
    findRepositoryActivity: async () => [],
    findRankingActivity,
    getStatusSnapshot: async () => null,
  } satisfies CollectionReadPort;

  return {
    service: new RankingService(collection),
    findRankingActivity,
  };
}
