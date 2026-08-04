import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService cache and year scope', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('동시·반복 요청은 같은 집계를 공유하고 연도 스코프를 저장소에 전달한다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'mina', 2, 0, 0),
    ]);

    await Promise.all([
      harness.service.findPage(2026, 1, 20),
      harness.service.findPage(2026, 2, 1),
    ]);
    await harness.service.findPage(2026, 1, 20);

    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(1);
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });

  it('연도별로 별도 cache key와 metric 기간을 사용한다', async () => {
    harness.getPublicRankingMetrics
      .mockResolvedValueOnce([activity(1n, 'mina', 2, 0, 0)])
      .mockResolvedValueOnce([activity(1n, 'mina', 3, 0, 0)]);

    await expect(harness.service.findPage(2025, 1, 20)).resolves.toMatchObject({
      year: 2025,
      total: 1,
    });
    await expect(harness.service.findPage(2026, 1, 20)).resolves.toMatchObject({
      year: 2026,
      total: 1,
    });

    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(2);
    expect(harness.getPublicRankingMetrics).toHaveBeenNthCalledWith(1, {
      currentYear: 2025,
    });
    expect(harness.getPublicRankingMetrics).toHaveBeenNthCalledWith(2, {
      currentYear: 2026,
    });
  });

  it('특정 연도와 전체는 별도 cache key와 metric 기간을 사용한다', async () => {
    harness.getPublicRankingMetrics
      .mockResolvedValueOnce([activity(1n, 'mina', 2, 0, 0)])
      .mockResolvedValueOnce([
        activity(1n, 'mina', 2, 0, 0),
        activity(2n, 'june', 0, 0, 1),
      ]);

    await expect(harness.service.findPage(2026, 1, 20)).resolves.toMatchObject({
      total: 1,
    });
    const all = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);
    expect(all).toMatchObject({
      year: RANKING_YEAR_ALL,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    expect(all.items).toHaveLength(2);
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(2);
    expect(harness.getPublicRankingMetrics).toHaveBeenLastCalledWith({});
  });

  it('listYears는 공개 연도 목록을 collection port에 위임한다', async () => {
    harness.listPublicRankingYears.mockResolvedValue([2026, 2025]);

    await expect(harness.service.listYears()).resolves.toEqual([2026, 2025]);
    expect(harness.listPublicRankingYears).toHaveBeenCalledTimes(1);
  });
});
