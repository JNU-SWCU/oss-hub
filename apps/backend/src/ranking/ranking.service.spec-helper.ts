import {
  RankingRepository,
  type CanonicalRankingActivity,
} from './ranking.repository';
import { RankingService } from './ranking.service';

export function activity(
  githubId: bigint,
  githubLogin: string,
  commitCount: number,
  prCount: number,
  releaseCount: number,
): CanonicalRankingActivity {
  return { githubId, githubLogin, commitCount, prCount, releaseCount };
}

export function setupRankingService(): {
  readonly service: RankingService;
  readonly findCanonicalActivity: jest.Mock;
} {
  const findCanonicalActivity = jest.fn().mockResolvedValue([]);
  const repository = { findCanonicalActivity } as unknown as RankingRepository;

  return {
    service: new RankingService(repository),
    findCanonicalActivity,
  };
}
