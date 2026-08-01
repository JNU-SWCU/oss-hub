import { RANKING_NOTICE, RANKING_PERIODS } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService cache and period', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('동시·반복 요청은 같은 집계를 공유하고 올해 시작 시각을 저장소에 전달한다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'mina', 2, 0, 0),
    ]);
    const now = new Date('2026-07-21T00:00:00.000Z');

    await Promise.all([
      harness.service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now),
      harness.service.findPage(RANKING_PERIODS.THIS_YEAR, 2, 1, now),
    ]);
    await harness.service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now);

    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(1);
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });

  it('uses the Asia/Seoul year for THIS_YEAR cache and projection metrics', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(2n, 'june', 3, 0, 0),
    ]);

    await expect(
      harness.service.findPage(
        RANKING_PERIODS.THIS_YEAR,
        1,
        20,
        new Date('2025-12-31T15:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ total: 1 });
    await harness.service.findPage(
      RANKING_PERIODS.THIS_YEAR,
      1,
      20,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(1);
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });

  it('올해와 전체는 별도 cache key와 metric 기간을 사용한다', async () => {
    harness.getPublicRankingMetrics
      .mockResolvedValueOnce([activity(1n, 'mina', 2, 0, 0)])
      .mockResolvedValueOnce([
        activity(1n, 'mina', 2, 0, 0),
        activity(2n, 'june', 0, 0, 1),
      ]);
    const now = new Date('2026-07-21T00:00:00.000Z');

    await expect(
      harness.service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now),
    ).resolves.toMatchObject({ total: 1 });
    const all = await harness.service.findPage(RANKING_PERIODS.ALL, 1, 20, now);
    expect(all).toMatchObject({
      notice: RANKING_NOTICE,
      period: RANKING_PERIODS.ALL,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    expect(all.items).toHaveLength(2);
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(2);
    expect(harness.getPublicRankingMetrics).toHaveBeenLastCalledWith({});
  });
});
