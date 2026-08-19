import type {
  CollectionPublicRankingMetricsDto,
  CollectionPublicRankingMetricsQueryDto,
  CollectionReadPort,
} from '../github/collection-read.port';
import type { UserDisplayNameRepository } from '../users/user-display-name.repository';
import { RANKING_YEAR_ALL } from './domain/ranking';
import { RankingService } from './service/ranking.service';

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
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 0,
        starCount: 0,
        department: null,
      },
      {
        githubId: 21n,
        githubLogin: 'a',
        commitCount: 3,
        pullRequestCount: 0,
        issueCount: 1,
        repositoryCount: 0,
        starCount: 0,
        department: null,
      },
      {
        githubId: 22n,
        githubLogin: 'b',
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        department: null,
      },
      {
        githubId: 23n,
        githubLogin: 'c',
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 0,
        starCount: 0,
        department: null,
      },
      {
        githubId: 10n,
        githubLogin: 'Same',
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 0,
        starCount: 0,
        department: null,
      },
      {
        githubId: 2n,
        githubLogin: 'same',
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 1,
        repositoryCount: 0,
        starCount: 0,
        department: null,
      },
      {
        githubId: 30n,
        githubLogin: 'top',
        commitCount: 6,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        department: null,
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
      getPublicRankingDataAsOf: () => Promise.resolve(null),
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
    // 공개 응답은 사람 축 5종 + 봉투가 전부다 — 실명은 어느 계층에도 없다.
    expect(page.items[0]).not.toHaveProperty('name');
    expect(page.items[0]).not.toHaveProperty('releaseCount');
  });
});
