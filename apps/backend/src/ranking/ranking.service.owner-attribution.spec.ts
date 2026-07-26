import { RANKING_PERIODS } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService canonical actor attribution', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('uses the canonical author numeric ID and login without repository-owner attribution', async () => {
    harness.findCanonicalActivity.mockResolvedValue([
      activity(22n, 'release-author', 0, 0, 1),
    ]);

    const result = await harness.service.findPage(RANKING_PERIODS.ALL, 1, 20);

    expect(result.items).toEqual([
      {
        rank: 1,
        displayName: 'release-author',
        githubLogin: 'release-author',
        commitCount: 0,
        prCount: 0,
        releaseCount: 1,
        total: 1,
      },
    ]);
  });

  it('does not invent entries for private or ghost activity excluded by the repository', async () => {
    harness.findCanonicalActivity.mockResolvedValue([]);

    await expect(
      harness.service.findPage(RANKING_PERIODS.ALL, 1, 20),
    ).resolves.toMatchObject({ items: [], total: 0 });
  });

  it('orders exact ties by metrics, normalized login, then numeric actor ID', async () => {
    harness.findCanonicalActivity.mockResolvedValue([
      activity(40n, 'zeta', 1, 2, 0),
      activity(30n, 'beta', 2, 0, 1),
      activity(20n, 'Alpha', 2, 0, 1),
      activity(10n, 'same', 1, 1, 0),
      activity(9n, 'same', 1, 1, 0),
    ]);

    const result = await harness.service.findPage(RANKING_PERIODS.ALL, 1, 20);

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
