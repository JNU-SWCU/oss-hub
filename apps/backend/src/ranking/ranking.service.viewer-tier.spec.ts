import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService viewer class', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  describe('public class (anonymous · STUDENT · deactivated)', () => {
    it('STUDENT githubId stays public and does not look up names', async () => {
      harness.findViewerClass.mockResolvedValue('public');
      harness.findMetrics.mockResolvedValue([
        activity(1n, 'octo-cat', { commitCount: 2, department: '전자공학과' }),
      ]);

      const page = await harness.service.findPage(2026, 1, 20, 11n);

      expect(harness.findViewerClass).toHaveBeenCalledWith(11n);
      expect(harness.findMetrics).toHaveBeenCalledWith({ currentYear: 2026 });
      expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
      expect(page.viewerClass).toBe('public');
      expect(page.nextCycleAt).toBeNull();
      expect(page.items[0]).toMatchObject({
        displayName: 'octo-cat',
        githubLogin: 'octo-cat',
        department: '전자공학과',
      });
      expect(page.items[0]).not.toHaveProperty('name');
    });

    it('DEACTIVATED githubId stays public', async () => {
      harness.findViewerClass.mockResolvedValue('public');
      harness.findMetrics.mockResolvedValue([
        activity(1n, 'octo-cat', { commitCount: 2 }),
      ]);

      const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, 88n);

      expect(harness.findViewerClass).toHaveBeenCalledWith(88n);
      expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
      expect(page.viewerClass).toBe('public');
      expect(page.items[0]).not.toHaveProperty('name');
    });

    it('null githubId is public and does not look up names', async () => {
      harness.findMetrics.mockResolvedValue([
        activity(1n, 'octo-cat', { commitCount: 2 }),
      ]);

      const page = await harness.service.findPage(
        RANKING_YEAR_ALL,
        1,
        20,
        null,
      );

      expect(harness.findViewerClass).toHaveBeenCalledWith(null);
      expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
      expect(page.viewerClass).toBe('public');
      expect(page.items[0]?.displayName).toBe('octo-cat');
      expect(page.items[0]).not.toHaveProperty('name');
    });
  });

  describe('staff class', () => {
    it('joins names on the page slice only', async () => {
      harness.findViewerClass.mockResolvedValue('staff');
      harness.findMetrics.mockResolvedValue([
        activity(1n, 'alpha', { commitCount: 5 }),
        activity(2n, 'bravo', { commitCount: 4 }),
        activity(3n, 'charlie', { commitCount: 3 }),
      ]);
      harness.findNamesByGithubIds.mockResolvedValue(
        new Map<bigint, string | null>([[2n, '홍길동']]),
      );

      const page = await harness.service.findPage(2026, 2, 1, 99n);

      expect(harness.findViewerClass).toHaveBeenCalledWith(99n);
      expect(harness.findNamesByGithubIds).toHaveBeenCalledTimes(1);
      expect(harness.findNamesByGithubIds).toHaveBeenCalledWith([2n]);
      expect(page.viewerClass).toBe('staff');
      expect(page.items).toEqual([
        expect.objectContaining({
          rank: 2,
          displayName: 'bravo',
          githubLogin: 'bravo',
          department: null,
          name: '홍길동',
          commitCount: 4,
        }),
      ]);
    });

    it('uses null name when the slice row has no 실명', async () => {
      harness.findViewerClass.mockResolvedValue('staff');
      harness.findMetrics.mockResolvedValue([
        activity(1n, 'nameless-user', { commitCount: 1 }),
      ]);
      harness.findNamesByGithubIds.mockResolvedValue(
        new Map<bigint, string | null>([[1n, null]]),
      );

      const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, 99n);

      expect(page.viewerClass).toBe('staff');
      expect(page.items[0]).toMatchObject({
        displayName: 'nameless-user',
        githubLogin: 'nameless-user',
        name: null,
      });
    });
  });

  it('name lookup throw fail-closes to public DTO and viewerClass public', async () => {
    harness.findViewerClass.mockResolvedValue('staff');
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'octo-cat', { commitCount: 2, department: '전자공학과' }),
    ]);
    harness.findNamesByGithubIds.mockRejectedValue(
      new Error('name lookup failed'),
    );

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, 99n);

    expect(page.viewerClass).toBe('public');
    expect(page.nextCycleAt).toBeNull();
    expect(page.items[0]).toMatchObject({
      displayName: 'octo-cat',
      githubLogin: 'octo-cat',
      department: '전자공학과',
    });
    expect(page.items[0]).not.toHaveProperty('name');
  });

  it('등수는 viewer class와 무관하게 동일하다 — 실명이 순서를 바꾸지 않는다', async () => {
    const rows = [
      activity(1n, 'alpha', { commitCount: 5 }),
      activity(2n, 'bravo', { commitCount: 5 }),
      activity(3n, 'charlie', { commitCount: 9 }),
    ];
    harness.findMetrics.mockResolvedValue(rows);
    harness.findNamesByGithubIds.mockResolvedValue(
      new Map<bigint, string | null>([
        [1n, '하동수'],
        [2n, '가영희'],
        [3n, '나철수'],
      ]),
    );

    harness.findViewerClass.mockResolvedValue('public');
    const publicPage = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      null,
    );
    harness.findViewerClass.mockResolvedValue('staff');
    const staffPage = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      99n,
    );

    const order = (page: typeof publicPage) =>
      page.items.map((item) => `${item.rank}:${item.githubLogin}`);
    expect(order(publicPage)).toEqual(['1:charlie', '2:alpha', '3:bravo']);
    expect(order(staffPage)).toEqual(order(publicPage));
    expect(staffPage.items.map((item) => item.displayName)).toEqual([
      'charlie',
      'alpha',
      'bravo',
    ]);
  });

  it('concurrent staff and anonymous share a year-only in-flight build', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'octo-cat', { commitCount: 2 }),
    ]);
    harness.findNamesByGithubIds.mockResolvedValue(
      new Map<bigint, string | null>([[1n, '홍길동']]),
    );
    harness.findViewerClass.mockImplementation(async (githubId) =>
      githubId === null ? 'public' : 'staff',
    );

    const [publicPage, staffPage] = await Promise.all([
      harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null),
      harness.service.findPage(RANKING_YEAR_ALL, 1, 20, 99n),
    ]);

    expect(harness.findMetrics).toHaveBeenCalledTimes(1);
    expect(publicPage.viewerClass).toBe('public');
    expect(publicPage.items[0]).not.toHaveProperty('name');
    expect(publicPage.items[0]?.displayName).toBe('octo-cat');
    expect(staffPage.viewerClass).toBe('staff');
    expect(staffPage.items[0]).toMatchObject({
      displayName: 'octo-cat',
      name: '홍길동',
    });
  });
});
