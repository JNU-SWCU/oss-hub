import { RANKING_PERIODS } from './domain/ranking';
import {
  batches,
  event,
  setupRankingService,
} from './ranking.service.spec-helper';

describe('RankingService owner attribution', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('credits a started watch to the mapped repository owner, not the actor', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'star-owned-repository',
          '22',
          'watching-actor',
          'WatchEvent',
          'started',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
      ]),
    );
    const owner = {
      githubRepositoryId: 101n,
      ownerGithubId: 11n,
      ownerGithubLogin: 'repository-owner',
    } as const;
    const ownerBacked = harness.serviceWithRepositoryOwners([owner]);

    const result = await ownerBacked.service.findPage(
      RANKING_PERIODS.ALL,
      1,
      20,
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        githubLogin: 'repository-owner',
        starCount: 1,
        total: 1,
      }),
    ]);
    expect(result.items).not.toContainEqual(
      expect.objectContaining({ githubLogin: 'watching-actor' }),
    );
    expect(ownerBacked.findMany).toHaveBeenCalledWith({
      where: { githubRepositoryId: { in: [101n] } },
      select: {
        githubRepositoryId: true,
        ownerGithubId: true,
        ownerGithubLogin: true,
      },
    });
  });

  it('excludes a started watch when its repository has no owner projection', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'star-unmapped-repository',
          '22',
          'watching-actor',
          'WatchEvent',
          'started',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
      ]),
    );
    const ownerBacked = harness.serviceWithRepositoryOwners([]);

    const result = await ownerBacked.service.findPage(
      RANKING_PERIODS.ALL,
      1,
      20,
    );

    expect(result.items).toEqual([]);
    expect(ownerBacked.findMany).toHaveBeenCalledWith({
      where: { githubRepositoryId: { in: [101n] } },
      select: {
        githubRepositoryId: true,
        ownerGithubId: true,
        ownerGithubLogin: true,
      },
    });
  });

  it('credits one owner star for a repeated source event observed in team contexts', async () => {
    harness.findObservationBatches.mockReturnValue(
      batches([
        event(
          'shared-star-source',
          '22',
          'first-team-member',
          'WatchEvent',
          'started',
          101,
          '2026-07-01T00:00:00.000Z',
        ),
        event(
          'shared-star-source',
          '33',
          'second-team-member',
          'WatchEvent',
          'started',
          101,
          '2026-07-01T00:00:00.000Z',
          undefined,
          '2026-07-02T00:00:00.000Z',
        ),
      ]),
    );
    const ownerBacked = harness.serviceWithRepositoryOwners([
      {
        githubRepositoryId: 101n,
        ownerGithubId: 11n,
        ownerGithubLogin: 'repository-owner',
      },
    ]);

    const result = await ownerBacked.service.findPage(
      RANKING_PERIODS.ALL,
      1,
      20,
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        githubLogin: 'repository-owner',
        starCount: 1,
        total: 1,
      }),
    ]);
  });
});
