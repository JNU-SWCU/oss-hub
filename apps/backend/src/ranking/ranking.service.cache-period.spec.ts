import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService cache and year scope', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('동시 요청만 같은 집계를 공유하고 다음 요청은 공개 상태를 다시 읽는다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'mina', { commitCount: 2 }),
    ]);

    await Promise.all([
      harness.service.findPage(2026, 1, 20, null),
      harness.service.findPage(2026, 2, 1, null),
    ]);
    await harness.service.findPage(2026, 1, 20, null);

    expect(harness.findMetrics).toHaveBeenCalledTimes(2);
    expect(harness.findMetrics).toHaveBeenNthCalledWith(1, {
      currentYear: 2026,
    });
    expect(harness.findMetrics).toHaveBeenNthCalledWith(2, {
      currentYear: 2026,
    });
  });

  it('연도별로 별도 요청 key와 metric 기간을 사용한다', async () => {
    harness.findMetrics
      .mockResolvedValueOnce([activity(1n, 'mina', { commitCount: 2 })])
      .mockResolvedValueOnce([activity(1n, 'mina', { commitCount: 3 })]);

    await expect(
      harness.service.findPage(2025, 1, 20, null),
    ).resolves.toMatchObject({
      year: 2025,
      total: 1,
      viewerClass: 'public',
      nextCycleAt: null,
    });
    await expect(
      harness.service.findPage(2026, 1, 20, null),
    ).resolves.toMatchObject({
      year: 2026,
      total: 1,
      viewerClass: 'public',
      nextCycleAt: null,
    });

    expect(harness.findMetrics).toHaveBeenCalledTimes(2);
    expect(harness.findMetrics).toHaveBeenNthCalledWith(1, {
      currentYear: 2025,
    });
    expect(harness.findMetrics).toHaveBeenNthCalledWith(2, {
      currentYear: 2026,
    });
  });

  it('특정 연도와 전체는 별도 요청 key와 metric 기간을 사용한다', async () => {
    harness.findMetrics
      .mockResolvedValueOnce([activity(1n, 'mina', { commitCount: 2 })])
      .mockResolvedValueOnce([
        activity(1n, 'mina', { commitCount: 2 }),
        activity(2n, 'june', { issueCount: 1 }),
      ]);

    await expect(
      harness.service.findPage(2026, 1, 20, null),
    ).resolves.toMatchObject({
      total: 1,
    });
    const all = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);
    expect(all).toMatchObject({
      year: RANKING_YEAR_ALL,
      page: 1,
      pageSize: 20,
      total: 2,
      viewerClass: 'public',
      nextCycleAt: null,
    });
    expect(all.items).toHaveLength(2);
    expect(all.items[0]).not.toHaveProperty('name');
    expect(harness.findMetrics).toHaveBeenCalledTimes(2);
    expect(harness.findMetrics).toHaveBeenLastCalledWith({});
  });

  it('listYears는 공개 연도 목록을 ranking repository에 위임한다', async () => {
    harness.listYears.mockResolvedValue([2026, 2025]);

    await expect(harness.service.listYears()).resolves.toEqual([2026, 2025]);
    expect(harness.listYears).toHaveBeenCalledTimes(1);
  });
});
