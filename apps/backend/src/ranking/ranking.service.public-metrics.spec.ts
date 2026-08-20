import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService public metrics', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('5종 지표와 그 단순 합을 total 로 돌려준다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'mina', {
        commitCount: 2,
        pullRequestCount: 1,
        issueCount: 3,
        repositoryCount: 4,
        starCount: 5,
        department: '소프트웨어공학과',
      }),
    ]);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);

    expect(page).toEqual({
      year: RANKING_YEAR_ALL,
      items: [
        {
          rank: 1,
          displayName: 'mina',
          githubLogin: 'mina',
          department: '소프트웨어공학과',
          commitCount: 2,
          pullRequestCount: 1,
          issueCount: 3,
          repositoryCount: 4,
          starCount: 5,
          total: 15,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      dataAsOf: null,
      viewerClass: 'public',
      nextCycleAt: null,
    });
    expect(page.items[0]).not.toHaveProperty('name');
    expect(harness.findMetrics).toHaveBeenCalledWith({});
  });

  it('passes the requested calendar year to the canonical repository', async () => {
    await harness.service.findPage(2026, 1, 20, null);

    expect(harness.findMetrics).toHaveBeenCalledWith({
      currentYear: 2026,
    });
  });
});

describe('RankingService — 수치와 갱신 시각은 모두 현재 상태에서 온다', () => {
  it('같은 연도를 두 번 조회해도 목록과 갱신 시각을 모두 다시 묻는다', async () => {
    const harness = setupRankingService();
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'mina', {
        commitCount: 2,
        pullRequestCount: 1,
        issueCount: 3,
      }),
    ]);
    harness.findDataAsOf.mockResolvedValue(
      new Date('2026-08-09T00:00:00.000Z'),
    );

    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);
    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);

    expect(harness.findMetrics).toHaveBeenCalledTimes(2);
    expect(harness.findDataAsOf).toHaveBeenCalledTimes(2);
  });

  it('관측이 하나도 없으면 갱신 시각은 null 이다', async () => {
    const harness = setupRankingService();
    harness.findMetrics.mockResolvedValue([]);
    harness.findDataAsOf.mockResolvedValue(null);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);

    expect(page.dataAsOf).toBeNull();
    expect(page.viewerClass).toBe('public');
    expect(page.nextCycleAt).toBeNull();
  });
});
