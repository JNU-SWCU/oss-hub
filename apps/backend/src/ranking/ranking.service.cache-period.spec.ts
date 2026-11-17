import { activity, setupRankingService } from './ranking.service.spec.helpers';
import { RANKING_YEAR_ALL } from './ranking-year.service';

describe('RankingService page reads and year scope', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks the repository for exactly the requested page window', async () => {
    harness.useRows([activity(1n, 'mina', { commitCount: 2 })]);

    await harness.service.findPage(2026, 3, 25, null);

    expect(harness.findRankedPage).toHaveBeenCalledWith(
      { currentYear: 2026 },
      { offset: 50, limit: 25 },
      expect.any(Date),
    );
  });

  it('특정 연도와 전체는 서로 다른 metric 기간을 사용한다', async () => {
    harness.useRows([
      activity(1n, 'mina', { commitCount: 2 }),
      activity(2n, 'june', { issueCount: 1 }),
    ]);

    await harness.service.findPage(2026, 1, 20, null);
    const all = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);

    expect(all).toMatchObject({
      year: RANKING_YEAR_ALL,
      page: 1,
      pageSize: 20,
      total: 2,
      viewerClass: 'public',
      nextCycleAt: null,
    });
    expect(all.items[0]).not.toHaveProperty('name');
    expect(harness.findRankedPage).toHaveBeenNthCalledWith(
      1,
      { currentYear: 2026 },
      expect.anything(),
      expect.any(Date),
    );
    expect(harness.findRankedPage).toHaveBeenLastCalledWith(
      {},
      expect.anything(),
      expect.any(Date),
    );
  });

  it('수집 일정은 집계를 읽은 뒤 평가 시각으로 한 번 계산되어 응답에 그대로 실린다', async () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    jest.useFakeTimers({ now });
    const scheduled = new Date('2026-08-20T01:00:00.000Z');
    harness.useRows([activity(1n, 'mina', { commitCount: 2 })]);
    harness.nextScheduledCollectionAt.mockReturnValue(scheduled);

    const page = await harness.service.findPage(2026, 1, 20, null);

    expect(harness.nextScheduledCollectionAt).toHaveBeenCalledTimes(1);
    expect(harness.nextScheduledCollectionAt).toHaveBeenCalledWith(now);
    expect(page.nextCycleAt).toBe(scheduled);
  });

  it('listYears는 공개 연도 목록을 ranking repository에 위임한다', async () => {
    harness.listYears.mockResolvedValue([2026, 2025]);

    await expect(harness.service.listYears()).resolves.toEqual([2026, 2025]);
    expect(harness.listYears).toHaveBeenCalledTimes(1);
    expect(harness.nextScheduledCollectionAt).not.toHaveBeenCalled();
  });
});
