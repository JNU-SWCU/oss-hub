import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

describe('RankingService display name — 공개 계층 (D3 — GitHub nickname 단일화)', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('공개 경로는 실명 조회를 하지 않고 displayName은 githubLogin이다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(1n, 'octo-cat', { commitCount: 2 }),
    ]);

    const result = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      null,
    );

    expect(result.viewerClass).toBe('public');
    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'octo-cat',
        githubLogin: 'octo-cat',
        department: null,
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty('name');
    expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
  });

  it('여러 항목 모두 githubLogin으로만 표기된다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(3n, 'blank-name', { commitCount: 1 }),
      activity(4n, 'whitespace-name', { commitCount: 1 }),
    ]);

    const result = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      null,
    );

    expect(
      result.items.map(({ displayName, githubLogin }) => ({
        displayName,
        githubLogin,
      })),
    ).toEqual(
      expect.arrayContaining([
        { displayName: 'blank-name', githubLogin: 'blank-name' },
        { displayName: 'whitespace-name', githubLogin: 'whitespace-name' },
      ]),
    );
    expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
  });

  it('user 행이 없어도 githubLogin으로 표기된다', async () => {
    harness.findMetrics.mockResolvedValue([
      activity(5n, 'ghost-user', { commitCount: 1 }),
    ]);

    const result = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      null,
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'ghost-user',
        githubLogin: 'ghost-user',
      }),
    ]);
    expect(harness.findNamesByGithubIds).not.toHaveBeenCalled();
  });
});
