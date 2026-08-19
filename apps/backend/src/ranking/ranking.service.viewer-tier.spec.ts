import { RANKING_VIEWER_TIERS, RANKING_YEAR_ALL } from './domain/ranking';
import { activity, setupRankingService } from './ranking.service.spec-helper';

/**
 * todo 15 — 같은 `GET /ranking` 이 세션 역할에 따라 다른 칸을 내린다.
 *
 * 계층은 실질적으로 둘이다: 공개(비로그인·학생)와 교직원·관리자. 학과는 공개
 * 가능 정보라 두 계층이 모두 본다(owner 결정 2026-08-19). 교직원·관리자만
 * `displayName` 이 실명으로 바뀐다.
 *
 * 여기서 고정하는 두 불변식:
 * 1. 공개 계층 조회는 실명 컬럼을 **애초에 질의하지 않는다**(가져온 뒤 지우기 아님).
 * 2. **정렬은 계층과 무관하다** — 실명이 등수를 바꾸면 버그다.
 */
describe('RankingService 응답 계층 (todo 15)', () => {
  let harness: ReturnType<typeof setupRankingService>;

  beforeEach(() => {
    harness = setupRankingService();
  });

  describe('공개 계층 (비로그인 · STUDENT)', () => {
    it('실명을 질의하지 않는다 — includeRealName 을 켜지 않는다', async () => {
      harness.getPublicRankingMetrics.mockResolvedValue([
        activity(1n, 'octo-cat', { commitCount: 2, department: '전자공학과' }),
      ]);

      const page = await harness.service.findPage(
        2026,
        1,
        20,
        RANKING_VIEWER_TIERS.PUBLIC,
      );

      expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({
        currentYear: 2026,
      });
      expect(
        harness.getPublicRankingMetrics.mock.calls[0]?.[0],
      ).not.toHaveProperty('includeRealName');
      // 학과는 공개 계층에도 내려간다. displayName 은 githubLogin 그대로다.
      expect(page.items[0]).toMatchObject({
        displayName: 'octo-cat',
        githubLogin: 'octo-cat',
        department: '전자공학과',
      });
    });

    it('repository 가 실명을 실어 보내도 공개 계층 displayName 은 githubLogin 이다', async () => {
      // 방어선 2겹 — 질의를 안 하는 게 1차, 흘러 들어와도 안 쓰는 게 2차다.
      harness.getPublicRankingMetrics.mockResolvedValue([
        activity(1n, 'octo-cat', { commitCount: 2, realName: '홍길동' }),
      ]);

      const page = await harness.service.findPage(
        RANKING_YEAR_ALL,
        1,
        20,
        RANKING_VIEWER_TIERS.PUBLIC,
      );

      expect(page.items[0]?.displayName).toBe('octo-cat');
      expect(JSON.stringify(page.items)).not.toContain('홍길동');
    });

    it('계층을 생략하면 공개 계층이다 — 기본값이 안전한 쪽이다', async () => {
      harness.getPublicRankingMetrics.mockResolvedValue([
        activity(1n, 'octo-cat', { realName: '홍길동' }),
      ]);

      const page = await harness.service.findPage(RANKING_YEAR_ALL, 1, 20);

      expect(
        harness.getPublicRankingMetrics.mock.calls[0]?.[0],
      ).not.toHaveProperty('includeRealName');
      expect(page.items[0]?.displayName).toBe('octo-cat');
    });
  });

  describe('교직원·관리자 계층', () => {
    it('실명을 질의하고 displayName 을 실명으로 바꾼다', async () => {
      harness.getPublicRankingMetrics.mockResolvedValue([
        activity(1n, 'octo-cat', {
          commitCount: 2,
          department: '전자공학과',
          realName: '홍길동',
        }),
      ]);

      const page = await harness.service.findPage(
        2026,
        1,
        20,
        RANKING_VIEWER_TIERS.STAFF,
      );

      expect(harness.getPublicRankingMetrics).toHaveBeenCalledWith({
        currentYear: 2026,
        includeRealName: true,
      });
      expect(page.items[0]).toMatchObject({
        displayName: '홍길동',
        githubLogin: 'octo-cat',
        department: '전자공학과',
      });
    });

    it('실명이 null 이면 githubLogin 으로 떨어진다', async () => {
      harness.getPublicRankingMetrics.mockResolvedValue([
        activity(1n, 'nameless-user', { commitCount: 1, realName: null }),
      ]);

      const page = await harness.service.findPage(
        RANKING_YEAR_ALL,
        1,
        20,
        RANKING_VIEWER_TIERS.STAFF,
      );

      expect(page.items[0]?.displayName).toBe('nameless-user');
    });
  });

  it('등수는 계층과 무관하게 동일하다 — 실명이 순서를 바꾸지 않는다', async () => {
    // 실명 알파벳/가나다 순서를 githubLogin 순서와 일부러 어긋나게 심는다.
    const rows = [
      activity(1n, 'alpha', { commitCount: 5, realName: '하동수' }),
      activity(2n, 'bravo', { commitCount: 5, realName: '가영희' }),
      activity(3n, 'charlie', { commitCount: 9, realName: '나철수' }),
    ];
    harness.getPublicRankingMetrics.mockResolvedValue(rows);

    const publicPage = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      RANKING_VIEWER_TIERS.PUBLIC,
    );
    const staffPage = await harness.service.findPage(
      RANKING_YEAR_ALL,
      1,
      20,
      RANKING_VIEWER_TIERS.STAFF,
    );

    const order = (page: typeof publicPage) =>
      page.items.map((item) => `${item.rank}:${item.githubLogin}`);
    expect(order(publicPage)).toEqual(['1:charlie', '2:alpha', '3:bravo']);
    expect(order(staffPage)).toEqual(order(publicPage));
  });

  it('계층별 in-flight 빌드를 섞지 않는다 — 동시 요청이 서로의 계층을 물려받지 않는다', async () => {
    harness.getPublicRankingMetrics.mockResolvedValue([
      activity(1n, 'octo-cat', { realName: '홍길동' }),
    ]);

    const [publicPage, staffPage] = await Promise.all([
      harness.service.findPage(
        RANKING_YEAR_ALL,
        1,
        20,
        RANKING_VIEWER_TIERS.PUBLIC,
      ),
      harness.service.findPage(
        RANKING_YEAR_ALL,
        1,
        20,
        RANKING_VIEWER_TIERS.STAFF,
      ),
    ]);

    expect(publicPage.items[0]?.displayName).toBe('octo-cat');
    expect(staffPage.items[0]?.displayName).toBe('홍길동');
  });

  describe('계층 판정', () => {
    it('세션이 없으면 viewer repository 에 null 을 그대로 넘긴다', async () => {
      await harness.service.resolveViewerTier(null);

      expect(harness.findTier).toHaveBeenCalledWith(null);
    });

    it('세션이 있으면 그 githubId 로 묻는다', async () => {
      harness.findTier.mockResolvedValue(RANKING_VIEWER_TIERS.STAFF);

      await expect(harness.service.resolveViewerTier(77n)).resolves.toBe(
        RANKING_VIEWER_TIERS.STAFF,
      );
      expect(harness.findTier).toHaveBeenCalledWith(77n);
    });
  });
});
