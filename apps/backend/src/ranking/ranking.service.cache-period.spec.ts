import { RANKING_NOTICE, RANKING_PERIODS } from './domain/ranking';
import {
  batches,
  event,
  setupRankingService,
} from './ranking.service.spec-helper';

describe('RankingService cache and period', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('동시·반복 요청은 같은 집계를 공유하고 올해 시작 시각을 저장소에 전달한다', async () => {
    harness.findObservationBatches.mockImplementation(() =>
      batches([
        event(
          'one',
          '1',
          'mina',
          'PushEvent',
          null,
          101,
          '2026-07-01T00:00:00.000Z',
          2,
        ),
      ]),
    );
    const now = new Date('2026-07-21T00:00:00.000Z');

    await Promise.all([
      harness.service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now),
      harness.service.findPage(RANKING_PERIODS.THIS_YEAR, 2, 1, now),
    ]);
    await harness.service.findPage(RANKING_PERIODS.THIS_YEAR, 1, 20, now);

    expect(harness.findPlatformRepositoryIdBatches).toHaveBeenCalledTimes(1);
    expect(harness.findObservationBatches).toHaveBeenCalledTimes(1);
    expect(harness.findObservationBatches).toHaveBeenCalledWith(
      new Date('2026-01-01T00:00:00.000Z'),
    );
  });

  it('올해와 전체는 별도 cache key를 사용하고 기간을 event 시각으로 판정한다', async () => {
    const observations = [
      event(
        'this-year',
        '1',
        'mina',
        'PushEvent',
        null,
        101,
        '2026-01-01T00:00:00.000Z',
        2,
      ),
      event(
        'last-year',
        '2',
        'june',
        'WatchEvent',
        'started',
        101,
        '2025-12-31T23:59:59.000Z',
      ),
    ];
    harness.findObservationBatches.mockImplementation(() =>
      batches(observations),
    );
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
    expect(harness.findObservationBatches).toHaveBeenCalledTimes(2);
    expect(harness.findObservationBatches).toHaveBeenLastCalledWith(undefined);
  });
});
