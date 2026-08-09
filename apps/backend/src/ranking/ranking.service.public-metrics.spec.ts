import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService public metrics', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('returns the canonical commit, pull request, and release metrics', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'mina', 2, 1, 3),
    ]);

    await expect(
      harness.service.findPage(RANKING_YEAR_ALL, 1, 20),
    ).resolves.toEqual({
      year: RANKING_YEAR_ALL,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          commitCount: 2,
          pullRequestCount: 1,
          releaseCount: 3,
          total: 6,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      dataAsOf: null,
    });
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({});
  });

  it('passes the requested calendar year to the canonical repository', async () => {
    await harness.service.findPage(2026, 1, 20);

    expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });
});

/**
 * 갱신 시각은 목록 캐시 밖에 있어야 한다 (ADR-010 §10).
 *
 * 이번 사고의 본질은 "멈췄는데 아무도 몰랐다"였다. 갱신 시각이 목록과 함께
 * 60초 캐시를 타면, 수집이 멈춰도 시각이 계속 새로워지는 것처럼 보여
 * 정확히 감추려던 것을 감춘다.
 */
describe('RankingService — 갱신 시각은 목록 캐시 밖에서 온다', () => {
  it('같은 연도를 두 번 조회하면 목록은 캐시되지만 갱신 시각은 매번 다시 묻는다', async () => {
    const harness = setupRankingService();
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'mina', 2, 1, 3),
    ]);
    harness.getPublicRankingDataAsOf.mockResolvedValue(
      new Date('2026-08-09T00:00:00.000Z'),
    );

    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);
    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    // 목록은 캐시 적중이라 한 번만 조회한다.
    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(1);
    // 갱신 시각은 캐시 밖이라 매번 묻는다 — 멈추면 시각이 그대로 멈춰 보인다.
    expect(harness.getPublicRankingDataAsOf).toHaveBeenCalledTimes(2);
  });

  it('관측이 하나도 없으면 갱신 시각은 null 이다', async () => {
    const harness = setupRankingService();
    harness.getPublicRankingMetrics.mockResolvedValue([]);
    harness.getPublicRankingDataAsOf.mockResolvedValue(null);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(page.dataAsOf).toBeNull();
  });
});
