import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService identity and privacy', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('canonical activity의 결정된 login과 집계 metric을 그대로 사용한다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(77n, 'new-login', 2, 1, 0),
    ]);

    await expect(
      harness.service.findPage(RANKING_YEAR_ALL, 1, 20),
    ).resolves.toMatchObject({
      items: [
        { githubLogin: 'new-login', commitCount: 2, pullRequestCount: 1, total: 3 },
      ],
      total: 1,
    });
  });

  it('canonical 공개 활동에 포함된 identity만 랭킹에 사용한다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(77n, 'old-login', 2, 0, 0),
    ]);

    await expect(
      harness.service.findPage(RANKING_YEAR_ALL, 1, 20),
    ).resolves.toMatchObject({
      items: [
        { githubLogin: 'old-login', commitCount: 2, pullRequestCount: 0, total: 2 },
      ],
      total: 1,
    });
  });

  it('login이 같아도 githubId가 다르면 별도 entry로 유지한다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'shared', 2, 0, 0),
      activity(2n, 'shared', 0, 1, 0),
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.githubLogin)).toEqual([
      'shared',
      'shared',
    ]);
    expect(result.items.map((item) => item.total)).toEqual([2, 1]);
  });
});
