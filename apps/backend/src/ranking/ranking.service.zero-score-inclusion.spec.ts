import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

/**
 * PM 확정 정책 — 가입한 모든 사용자가 공개 랭킹에 노출된다. 기여가 없으면
 * 0/0/0으로 표시한다(`total > 0` 필터를 제거). 0점 동률이 대량으로 생기므로,
 * tiebreak(닉네임 정규화 오름차순 → githubId 오름차순)이 페이지를 넘나드는
 * 중복/누락 없이 결정적 순서를 보장하는지를 이 파일이 고정한다.
 */
describe('RankingService — 0점 사용자 포함과 동률 tiebreak', () => {
  it('기여가 없는 사용자도 0/0/0으로 결과에 포함된다', async () => {
    const harness = setupRankingService();
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'active-user', 3, 0, 0),
      activity(2n, 'fresh-signup', 0, 0, 0),
    ]);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(page.items).toEqual([
      expect.objectContaining({
        githubLogin: 'active-user',
        total: 3,
        rank: 1,
      }),
      expect.objectContaining({
        githubLogin: 'fresh-signup',
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
        total: 0,
        rank: 2,
      }),
    ]);
  });

  it('0점 동률은 정규화된 닉네임 오름차순, 그다음 githubId 오름차순으로 결정적으로 정렬된다', async () => {
    const harness = setupRankingService();
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(50n, 'Zed', 0, 0, 0),
      activity(10n, 'zed', 0, 0, 0),
      activity(30n, 'amy', 0, 0, 0),
      activity(20n, 'amy', 0, 0, 0),
    ]);

    const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

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
    harness.getPublicRankingMetrics.mockResolvedValue(
      Array.from({ length: userCount }, (_, index) =>
        // 상당수가 기여 0인 동률 — 페이지 경계에서 tiebreak 이 정렬을 흔들면
        // 중복/누락이 나타난다.
        activity(
          BigInt(index + 1),
          `user-${String(index).padStart(3, '0')}`,
          index % 5 === 0 ? 1 : 0,
          0,
          0,
        ),
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
