import { RANKING_NOTICE, RANKING_PERIODS } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService public metrics', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('returns the canonical commit, pull request, and release metrics', async () => {
    harness.findCanonicalActivity.mockResolvedValue([
      activity(1n, 'mina', 2, 1, 3),
    ]);

    await expect(
      harness.service.findPage(RANKING_PERIODS.ALL, 1, 20),
    ).resolves.toEqual({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.ALL,
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
    expect(harness.findCanonicalActivity).toHaveBeenCalledWith(undefined);
  });

  it('passes the Asia/Seoul current year to the canonical repository', async () => {
    await harness.service.findPage(
      RANKING_PERIODS.THIS_YEAR,
      1,
      20,
      new Date('2026-07-21T00:00:00.000Z'),
    );

    expect(harness.findCanonicalActivity).toHaveBeenCalledWith(2026);
  });
});
