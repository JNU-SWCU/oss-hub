import { activity, setupRankingService } from './ranking.service.spec.helpers';
import { RANKING_YEAR_ALL } from './ranking-year.service';

describe('RankingService viewer class', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  describe('public class (anonymous · STUDENT · deactivated)', () => {
    it('STUDENT githubId stays public and does not look up names', async () => {
      harness.findViewerClass.mockResolvedValue('public');
      harness.useRows([
        activity(1n, 'octo-cat', { commitCount: 2, department: '전자공학과' }),
      ]);

      const page = await harness.service.findPage(2026, 1, 20, 11n);

      expect(harness.findViewerClass).toHaveBeenCalledWith(11n);
      expect(harness.findRankedPage).toHaveBeenCalledWith(
        { currentYear: 2026 },
        expect.anything(),
        expect.any(Date),
      );
      expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
      expect(page.viewerClass).toBe('public');
      expect(page.nextCycleAt).toBeNull();
      expect(page.items[0]).toMatchObject({
        githubLogin: 'octo-cat',
        department: '전자공학과',
      });
      expect(page.items[0]).not.toHaveProperty('name');
    });

    it('DEACTIVATED githubId stays public', async () => {
      harness.findViewerClass.mockResolvedValue('public');
      harness.useRows([activity(1n, 'octo-cat', { commitCount: 2 })]);

      const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, 88n);

      expect(harness.findViewerClass).toHaveBeenCalledWith(88n);
      expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
      expect(page.viewerClass).toBe('public');
      expect(page.items[0]).not.toHaveProperty('name');
    });

    it('null githubId is public and does not look up names', async () => {
      harness.useRows([activity(1n, 'octo-cat', { commitCount: 2 })]);

      const page = await harness.service.findPage(
        RANKING_YEAR_ALL,
        1,
        20,
        null,
      );

      expect(harness.findViewerClass).toHaveBeenCalledWith(null);
      expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
      expect(page.viewerClass).toBe('public');
      expect(page.items[0]?.githubLogin).toBe('octo-cat');
      expect(page.items[0]).not.toHaveProperty('name');
    });
  });

  describe('member class', () => {
    it('member 는 이름을 조회하지 않고 member 봉투를 유지한다', async () => {
      harness.findViewerClass.mockResolvedValue('member');
      harness.useRows([
        activity(1n, 'octo-cat', { commitCount: 2, department: '전자공학과' }),
      ]);

      const page = await harness.service.findPage(2026, 1, 20, 11n);

      expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
      expect(page.viewerClass).toBe('member');
      expect(page.items[0]).not.toHaveProperty('name');
      expect(page.items[0]).toMatchObject({ githubLogin: 'octo-cat' });
    });
  });

  describe('staff class', () => {
    it('joins names on the page slice only', async () => {
      harness.findViewerClass.mockResolvedValue('staff');
      harness.useRows([
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
          githubLogin: 'bravo',
          department: null,
          name: '홍길동',
          commitCount: 4,
        }),
      ]);
    });

    it('uses null name when the slice row has no 실명', async () => {
      harness.findViewerClass.mockResolvedValue('staff');
      harness.useRows([activity(1n, 'nameless-user', { commitCount: 1 })]);
      harness.findNamesByGithubIds.mockResolvedValue(
        new Map<bigint, string | null>([[1n, null]]),
      );

      const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, 99n);

      expect(page.viewerClass).toBe('staff');
      expect(page.items[0]).toMatchObject({
        githubLogin: 'nameless-user',
        name: null,
      });
    });
  });

  it('name lookup throw fail-closes to public DTO and viewerClass public', async () => {
    harness.findViewerClass.mockResolvedValue('staff');
    harness.useRows([
      activity(1n, 'octo-cat', { commitCount: 2, department: '전자공학과' }),
    ]);
    harness.findNamesByGithubIds.mockRejectedValue(
      new Error('name lookup failed'),
    );

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, 99n);

    expect(page.viewerClass).toBe('public');
    expect(page.nextCycleAt).toBeNull();
    expect(page.items[0]).toMatchObject({
      githubLogin: 'octo-cat',
      department: '전자공학과',
    });
    expect(page.items[0]).not.toHaveProperty('name');
  });
});
