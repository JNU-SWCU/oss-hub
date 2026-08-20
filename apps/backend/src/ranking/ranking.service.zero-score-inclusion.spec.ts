import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService — 0점 사용자 포함과 동률 tiebreak', () => {
  it('관측이 없는 가입자도 5종 전부 0으로 결과에 포함된다', async () => {
    const harness = setupRankingService();
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'active-user', { commitCount: 3 }),
      activity(2n, 'fresh-signup', {}),
    ]);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);

    expect(page.viewerClass).toBe('public');
    expect(page.nextCycleAt).toBeNull();
    expect(page.items).toEqual([
      expect.objectContaining({
        githubLogin: 'active-user',
        department: null,
        total: 3,
        rank: 1,
      }),
      expect.objectContaining({
        githubLogin: 'fresh-signup',
        department: null,
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
        rank: 2,
      }),
    ]);
    expect(page.items[1]).not.toHaveProperty('name');
  });

  it('0점 동률은 정규화된 닉네임 오름차순, 그다음 githubId 오름차순으로 결정적으로 정렬된다', async () => {
    const harness = setupRankingService();
    harness.findMetrics.mockResolvedValue([
      activity(50n, 'Zed', {}),
      activity(10n, 'zed', {}),
      activity(30n, 'amy', {}),
      activity(20n, 'amy', {}),
    ]);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20, null);

    expect(
      page.items.map((item) => ({
        githubId: item.githubLogin,
        rank: item.rank,
      })),
    ).toEqual([
      { githubId: 'amy', rank: 1 },
      { githubId: 'amy', rank: 2 },
      { githubId: 'zed', rank: 3 },
      { githubId: 'Zed', rank: 4 },
    ]);
  });

  it('pageSize=10으로 전 페이지를 순회해도 중복/누락 없이 닉네임 보유 사용자 수와 총 행 수가 같다', async () => {
    const harness = setupRankingService();
    const userCount = 25;
    harness.findMetrics.mockResolvedValue(
      Array.from({ length: userCount }, (_, index) =>
        activity(BigInt(index + 1), `user-${String(index).padStart(3, '0')}`, {
          commitCount: index % 5 === 0 ? 1 : 0,
        }),
      ),
    );

    const pageSize = 10;
    const seenGithubIds = new Set<string>();
    let page = 1;
    let totalRowsSeen = 0;
    for (;;) {
      const result = await harness.service.findPage(
        RANKING_YEAR_ALL,
        page,
        pageSize,
        null,
      );
      if (result.items.length === 0) break;
      for (const item of result.items) {
        expect(seenGithubIds.has(item.githubLogin)).toBe(false);
        seenGithubIds.add(item.githubLogin);
      }
      totalRowsSeen += result.items.length;
      expect(result.total).toBe(userCount);
      if (page * pageSize >= result.total) break;
      page += 1;
    }

    expect(totalRowsSeen).toBe(userCount);
    expect(seenGithubIds.size).toBe(userCount);
  });
});
