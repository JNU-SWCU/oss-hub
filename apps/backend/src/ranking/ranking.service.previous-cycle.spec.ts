import { activity, setupRankingService } from './ranking.service.spec.helpers';

describe('RankingService — 직전 수집 대비 순위', () => {
  it('직전 수집 스냅샷의 순위를 previousRank로 싣는다', async () => {
    const harness = setupRankingService();
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'alpha', { commitCount: 5 }),
      activity(2n, 'beta', { commitCount: 9 }),
    ]);
    harness.findPreviousCycleMetrics.mockResolvedValue([
      activity(1n, 'alpha', { commitCount: 5 }),
      activity(2n, 'beta', { commitCount: 1 }),
    ]);

    const page = await harness.service.findPage(2026, 1, 20, null);

    expect(
      page.items.map(({ githubLogin, rank, previousRank }) => ({
        githubLogin,
        rank,
        previousRank,
      })),
    ).toEqual([
      { githubLogin: 'beta', rank: 1, previousRank: 2 },
      { githubLogin: 'alpha', rank: 2, previousRank: 1 },
    ]);
    expect(harness.findPreviousCycleMetrics).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });

  it('스냅샷이 아직 없으면 previousRank는 null이다', async () => {
    const harness = setupRankingService();
    harness.findMetrics.mockResolvedValue([activity(1n, 'alpha', {})]);

    const page = await harness.service.findPage(2026, 1, 20, null);

    expect(page.items[0]?.previousRank).toBeNull();
  });
});
