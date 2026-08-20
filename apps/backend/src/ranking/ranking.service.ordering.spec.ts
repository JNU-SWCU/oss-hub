import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService deterministic ordering', () => {
  it('orders every tie level and uses normalized login then numeric GitHub id', async () => {
    const harness = setupRankingService();
    harness.findMetrics.mockResolvedValue([
      activity(20n, 'z', {
        commitCount: 2,
        pullRequestCount: 1,
        issueCount: 1,
      }),
      activity(21n, 'a', {
        commitCount: 3,
        pullRequestCount: 0,
        issueCount: 1,
      }),
      activity(22n, 'b', {
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 0,
      }),
      activity(23n, 'c', {
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 1,
      }),
      activity(10n, 'Same', {
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 1,
      }),
      activity(2n, 'same', {
        commitCount: 3,
        pullRequestCount: 1,
        issueCount: 1,
      }),
      activity(30n, 'top', { commitCount: 6 }),
    ]);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);

    expect(page.viewerClass).toBe('public');
    expect(page.nextCycleAt).toBeNull();
    expect(page.items.map((item) => item.githubLogin)).toEqual([
      'top',
      'c',
      'same',
      'Same',
      'b',
      'a',
      'z',
    ]);
    expect(page.items[0]).toMatchObject({ department: null });
    expect(page.items[0]).not.toHaveProperty('name');
    expect(page.items[0]).not.toHaveProperty('releaseCount');
  });
});
