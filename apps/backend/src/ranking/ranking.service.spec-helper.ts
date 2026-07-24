import {
  RepositoryOwnerRepository,
  type RepositoryOwnerProjectionClient,
} from '../repository-ownership/repository-owner.repository';
import {
  RankingRepository,
  type RankingObservation,
} from './ranking.repository';
import { RankingService } from './ranking.service';

export function event(
  id: string,
  targetGithubId: string,
  targetLogin: string,
  type: string,
  action: string | null,
  repositoryId: number,
  createdAt: string,
  size?: number,
  runStartedAt = '2026-07-01T00:00:00.000Z',
): RankingObservation {
  return {
    id: `observation-${id}-${targetGithubId}-${runStartedAt}`,
    sourceId: id,
    targetGithubId,
    targetLogin,
    runId: `run-${targetGithubId}-${runStartedAt}`,
    runStartedAt: new Date(runStartedAt),
    payload: {
      type,
      created_at: createdAt,
      repo: { id: repositoryId },
      payload: {
        ...(action ? { action } : {}),
        ...(size === undefined ? {} : { size }),
        commits: [{ sha: 'must-not-be-counted' }, { sha: 'also-ignored' }],
      },
    },
  };
}

export async function* batches(
  observations: readonly RankingObservation[],
): AsyncGenerator<readonly RankingObservation[]> {
  await Promise.resolve();
  yield observations;
}

export async function* repositoryBatches(
  repositoryIds: readonly string[],
): AsyncGenerator<readonly string[]> {
  await Promise.resolve();
  yield repositoryIds;
}

type RepositoryOwner = {
  readonly githubRepositoryId: bigint;
  readonly ownerGithubId: bigint;
  readonly ownerGithubLogin: string;
};

export function setupRankingService(): {
  readonly service: RankingService;
  readonly findPlatformRepositoryIdBatches: jest.Mock;
  readonly findObservationBatches: jest.Mock;
  readonly serviceWithRepositoryOwners: (
    owners: readonly RepositoryOwner[],
  ) => {
    readonly service: RankingService;
    readonly findMany: jest.Mock;
  };
} {
  const findPlatformRepositoryIdBatches = jest
    .fn()
    .mockImplementation(() => repositoryBatches(['101']));
  const findObservationBatches = jest.fn();
  const repository = {
    findPlatformRepositoryIdBatches,
    findObservationBatches,
  } as unknown as RankingRepository;
  const defaultOwnerRepository = new RepositoryOwnerRepository({
    repositoryOwnerProjection: {
      findMany: jest.fn().mockResolvedValue([
        {
          githubRepositoryId: 101n,
          ownerGithubId: 2n,
          ownerGithubLogin: 'june',
        },
      ]),
    },
  });

  return {
    service: new RankingService(repository, defaultOwnerRepository),
    findPlatformRepositoryIdBatches,
    findObservationBatches,
    serviceWithRepositoryOwners: (owners) => {
      const findMany = jest.fn().mockResolvedValue(owners);
      const projectionClient: RepositoryOwnerProjectionClient = {
        repositoryOwnerProjection: { findMany },
      };
      const ownerRepository = new RepositoryOwnerRepository(projectionClient);

      return {
        service: new RankingService(repository, ownerRepository),
        findMany,
      };
    },
  };
}
