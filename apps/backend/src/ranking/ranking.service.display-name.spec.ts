import { RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

/**
 * 정책 결정 D3(.omc/plans/student-repo-ranking-tracking.md §1 "확정된 정책" 표,
 * `:41`) — **공개·학생 계층**의 `/ranking` 응답 표기는 GitHub nickname으로
 * 단일화한다. `d7bfc566`(`feat(ranking): 랭킹 표시 이름을 사용자 실명 우선으로
 * 바꾼다`)가 이 정책을 어기고 실명을 우선 노출하도록 바꿨던 것을 되돌린 회귀
 * 테스트다 — 실명 조회 결과가 무엇이든 `displayName`은 항상 `githubLogin`과
 * 같아야 하고, name lookup 자체가 더는 호출되지 않아야 한다. 이 파일은 계층을 주지
 * 않은(그래서 공개 계층인) 호출만 다룬다 — 교직원·관리자 계층은
 * `ranking.service.viewer-tier.spec.ts` 가 따로 고정한다(todo 15).
 */
describe('RankingService display name — 공개 계층 (D3 — GitHub nickname 단일화)', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  it('실명 조회 결과가 있어도 displayName은 githubLogin이다 — 실명이 비인증 공개 응답에 노출되지 않는다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'octo-cat', { commitCount: 2 }),
    ]);
    harness.findByGithubIds.mockResolvedValue([
      { githubId: 1n, name: 'Octo Cat' },
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'octo-cat',
        githubLogin: 'octo-cat',
      }),
    ]);
    expect(result.items[0]?.displayName).not.toBe('Octo Cat');
  });

  it('name lookup 자체를 호출하지 않는다 — 표시값이 githubLogin 하나뿐이라 실명 조회가 불필요하다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(2n, 'nameless', { commitCount: 1 }),
    ]);

    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(harness.findByGithubIds).not.toHaveBeenCalled();
  });

  it('여러 항목 모두 githubLogin으로만 표기된다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(3n, 'blank-name', { commitCount: 1 }),
      activity(4n, 'whitespace-name', { commitCount: 1 }),
    ]);
    harness.findByGithubIds.mockResolvedValue([
      { githubId: 3n, name: '' },
      { githubId: 4n, name: '   ' },
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

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
  });

  it('user 행이 없어도 githubLogin으로 표기된다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(5n, 'ghost-user', { commitCount: 1 }),
    ]);

    const result = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(result.items).toEqual([
      expect.objectContaining({
        displayName: 'ghost-user',
        githubLogin: 'ghost-user',
      }),
    ]);
  });

  it('빈 랭킹에서도 name lookup을 호출하지 않는다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([]);

    await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

    expect(harness.findByGithubIds).not.toHaveBeenCalled();
  });
});
