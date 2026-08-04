import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
  CollectionReadPort,
} from '../collection/collection-read.port';
import type { UserDisplayNameRepository } from '../users/user-display-name.repository';
import { RANKING_YEAR_ALL } from './domain/ranking';
import { RankingService } from './ranking.service';

describe('RankingService deterministic ordering', () => {
  it('orders every tie level and uses normalized login then numeric GitHub id', async () => {
    const getPublicRankingMetrics = jest.fn<
      Promise<readonly CollectionPublicRankingMetricsDto[]>,
      [CollectionPublicRankingMetricsQueryDto]
    >();
    getPublicRankingMetrics.mockResolvedValue([
      {
        githubId: 20n,
        githubLogin: 'z',
        commitCount: 2,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 21n,
        githubLogin: 'a',
        commitCount: 3,
        prCount: 0,
        releaseCount: 1,
      },
      {
        githubId: 22n,
        githubLogin: 'b',
        commitCount: 3,
        prCount: 1,
        releaseCount: 0,
      },
      {
        githubId: 23n,
        githubLogin: 'c',
        commitCount: 3,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 10n,
        githubLogin: 'Same',
        commitCount: 3,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 2n,
        githubLogin: 'same',
        commitCount: 3,
        prCount: 1,
        releaseCount: 1,
      },
      {
        githubId: 30n,
        githubLogin: 'top',
        commitCount: 6,
        prCount: 0,
        releaseCount: 0,
      },
    ]);
    const collection = {
      findRepositoryActivity: () => Promise.resolve([]),
      findRankingActivity: () => Promise.resolve([]),
      getStatusSnapshot: () => Promise.resolve(null),
      getRepositoryMetrics: () => Promise.resolve([]),
      getContributorMetrics: () => Promise.resolve([]),
      getPublicRankingMetrics,
      listPublicRankingYears: () => Promise.resolve([]),
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
    const displayNameRepository = {
      findByGithubIds: () => Promise.resolve([]),
    } as unknown as UserDisplayNameRepository;
    const service = new RankingService(collection, displayNameRepository);

    const page = await service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(page.items.map((item) => item.githubLogin)).toEqual([
      'top',
      'c',
      'same',
      'Same',
      'b',
      'a',
      'z',
    ]);
    expect(page.items[0]).not.toHaveProperty('starCount');
  });
});
