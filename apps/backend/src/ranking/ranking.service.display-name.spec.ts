import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService public user eligibility', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('shows only contributors present in the public eligibility projection', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'eligible-user', 2, 0, 0),
      activity(2n, 'withdrawn-user', 3, 0, 0),
    ]);
    harness.findEligibleGithubIds.mockResolvedValue(new Set([1n]));

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([
      {
        rank: 1,
        displayName: 'eligible-user',
        githubLogin: 'eligible-user',
        commitCount: 2,
        prCount: 0,
        releaseCount: 0,
        total: 2,
      },
    ]);
    expect(harness.findEligibleGithubIds).toHaveBeenCalledWith([1n, 2n]);
  });

  it('fails closed when no contributor has a public eligibility row', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(5n, 'ghost-user', 1, 0, 0),
    ]);
    harness.findEligibleGithubIds.mockResolvedValue(new Set());

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('uses the canonical GitHub login without reading a private profile name', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(6n, 'public-handle', 1, 0, 0),
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items[0]).toMatchObject({
      displayName: 'public-handle',
      githubLogin: 'public-handle',
    });
  });

  it('rechecks user eligibility even when activity metrics are cached', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(7n, 'revoked-user', 1, 0, 0),
    ]);
    harness.findEligibleGithubIds
      .mockResolvedValueOnce(new Set([7n]))
      .mockResolvedValueOnce(new Set());

    const first = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);
    const second = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(first.total).toBe(1);
    expect(second.total).toBe(0);
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(1);
    expect(harness.findEligibleGithubIds).toHaveBeenCalledTimes(2);
  });
});
