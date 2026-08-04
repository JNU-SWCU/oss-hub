import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService public metrics', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('returns the canonical commit, pull request, and release metrics', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'mina', 2, 1, 3),
    ]);

    await expect(
      harness.service.findPage(RANKING_YEAR_ALL, 1, 20),
    ).resolves.toEqual({
      year: RANKING_YEAR_ALL,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          prCount: 1,
          releaseCount: 3,
          total: 6,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({});
  });

  it('passes the requested calendar year to the canonical repository', async () => {
    await harness.service.findPage(2026, 1, 20);

    expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });
});
