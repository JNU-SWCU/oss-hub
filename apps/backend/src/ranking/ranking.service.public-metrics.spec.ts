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
 * 공개 목록과 갱신 시각은 요청마다 현재 DB 상태를 읽어야 한다 (ADR-010 §10).
 *
 * 이번 사고의 본질은 "멈췄는데 아무도 몰랐다"였다. 갱신 시각이 목록과 함께
 * 저장소 공개 상태가 회수된 뒤 이전 목록을 재사용하면 이미 비공개인 기여가
 * 남으므로, 완료된 목록 결과는 캐시하지 않는다.
 */
describe('RankingService — 수치와 갱신 시각은 모두 현재 상태에서 온다', () => {
  it('같은 연도를 두 번 조회해도 목록과 갱신 시각을 모두 다시 묻는다', async () => {
    const harness = setupRankingService();
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'mina', 2, 1, 3),
    ]);
    harness.getPublicRankingDataAsOf.mockResolvedValue(
      new Date('2026-08-09T00:00:00.000Z'),
    );

    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);
    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(harness.getPublicRankingMetrics).toHaveBeenCalledTimes(2);
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
