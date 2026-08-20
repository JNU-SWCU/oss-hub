import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService canonical actor attribution', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('uses the canonical actor numeric ID and login without repository-owner attribution', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(22n, 'issue-author', { issueCount: 1 }),
    ]);

    const result = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      null,
    );

    expect(result.viewerClass).toBe('public');
    expect(result.nextCycleAt).toBeNull();
    expect(result.items).toEqual([
      {
        rank: 1,
        displayName: 'issue-author',
        githubLogin: 'issue-author',
        department: null,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 1,
        repositoryCount: 0,
        starCount: 0,
        total: 1,
      },
    ]);
    expect(result.items[0]).not.toHaveProperty('name');
  });

  it('does not invent entries for private or ghost activity excluded by the repository', async () => {
    harness.findMetrics.mockResolvedValue([]);

    await expect(
      harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null),
    ).resolves.toMatchObject({
      items: [],
      total: 0,
      viewerClass: 'public',
      nextCycleAt: null,
    });
  });

  it('orders exact ties by metrics, normalized login, then numeric actor ID', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(40n, 'zeta', { commitCount: 1, pullRequestCount: 2 }),
      activity(30n, 'beta', { commitCount: 2, issueCount: 1 }),
      activity(20n, 'Alpha', { commitCount: 2, issueCount: 1 }),
      activity(10n, 'same', { commitCount: 1, pullRequestCount: 1 }),
      activity(9n, 'same', { commitCount: 1, pullRequestCount: 1 }),
    ]);

    const result = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      null,
    );

    expect(
      result.items.map(({ githubLogin, total, rank }) => ({
        githubLogin,
        total,
        rank,
      })),
    ).toEqual([
      { githubLogin: 'Alpha', total: 3, rank: 1 },
      { githubLogin: 'beta', total: 3, rank: 2 },
      { githubLogin: 'zeta', total: 3, rank: 3 },
      { githubLogin: 'same', total: 2, rank: 4 },
      { githubLogin: 'same', total: 2, rank: 5 },
    ]);
  });
});
