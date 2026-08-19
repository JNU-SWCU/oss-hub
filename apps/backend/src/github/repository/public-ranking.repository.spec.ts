import { PublicRankingRepository } from './public-ranking.repository';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 공개 랭킹 strict-read 계약 (`AGENTS.md` §4 · ADR-003).
 *
 * 랭킹 endpoint 에는 인증 가드가 없는데 읽는 대상은 private 테이블이다.
 * 그 조합이 허용되는 유일한 경로가 이 repository 이므로, 여기서 지켜야 하는
 * 것들을 테스트가 직접 잡는다 — 코드 리뷰에만 맡기지 않는다.
 *
 * 수치의 출처는 **사람 축**(`GithubUserActivityHistory`)이다. 저장소 축
 * (`Contribution`)이 아니다 — 저장소 가시성·소속 조건이 이 파일에 없다는 것
 * 자체가 계약이며 아래 테스트가 그걸 고정한다. `findMetrics` 는 `User` 에서
 * 시작해 사람 축 이력을 애플리케이션 레벨에서 LEFT JOIN 한다(FK 가 아니라
 * githubId 값 조인이라 Prisma relation include 가 안 된다).
 */

/** Prisma 호출 인자를 구조로 본다 — any 로 두면 계약 검사가 무의미해진다. */
interface FindManyArgs {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  distinct?: unknown;
  include?: unknown;
}

interface MockPrisma {
  githubUserActivityHistory: {
    findMany: jest.Mock<Promise<unknown[]>, [FindManyArgs]>;
    aggregate: jest.Mock<
      Promise<{ _max: { observedAt: Date | null } }>,
      [FindManyArgs]
    >;
  };
  user: { findMany: jest.Mock<Promise<unknown[]>, [FindManyArgs]> };
}

function argsOf(
  mock: { mock: { calls: [FindManyArgs][] } },
  index = 0,
): FindManyArgs {
  const call = mock.mock.calls[index];
  if (call === undefined) throw new Error('호출되지 않았다');
  return call[0];
}

const createDb = (): MockPrisma => {
  const findMany = jest.fn<Promise<unknown[]>, [FindManyArgs]>();
  findMany.mockResolvedValue([]);
  const aggregate = jest.fn<
    Promise<{ _max: { observedAt: Date | null } }>,
    [FindManyArgs]
  >();
  aggregate.mockResolvedValue({ _max: { observedAt: null } });
  const userFindMany = jest.fn<Promise<unknown[]>, [FindManyArgs]>();
  userFindMany.mockResolvedValue([]);
  return {
    githubUserActivityHistory: { findMany, aggregate },
    user: { findMany: userFindMany },
  };
};

const repositoryFor = (db: MockPrisma): PublicRankingRepository =>
  new PublicRankingRepository(db as unknown as PrismaService);

/** 사람 축 관측 한 행 — 테스트 가독성을 위한 조립기. */
const observation = (
  githubId: bigint,
  year: number,
  counts: Partial<{
    commitCount: number;
    pullRequestCount: number;
    issueCount: number;
    repositoryCount: number;
    starCount: number;
  }> = {},
): Record<string, unknown> => ({
  githubId,
  year,
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
  ...counts,
});

/** 가입자 한 명 — 학과는 legacy `User.department` 만 채운 형태가 기본이다. */
const signup = (
  githubId: bigint,
  nickname: string | null,
  department: string | null = null,
  profileDepartment: string | null = null,
): Record<string, unknown> => ({
  githubId,
  nickname,
  department,
  profile:
    profileDepartment === null ? null : { department: profileDepartment },
});

describe('PublicRankingRepository — 공개 strict-read 계약', () => {
  describe('사람 축을 읽는다 (저장소 축이 아니다)', () => {
    it('저장소 조건 없이 사람 축 이력만 조회한다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const args = argsOf(db.githubUserActivityHistory.findMany);
      // 저장소 가시성·소속은 사람 축 질문과 무관하다 — 조건 자체가 없어야 한다.
      expect(args.where).toEqual({});
      const whereKeys = JSON.stringify(args.where ?? {});
      expect(whereKeys).not.toContain('repository');
      expect(whereKeys).not.toContain('visibility');
      expect(whereKeys).not.toContain('presence');
      expect(whereKeys).not.toContain('source');
    });

    it('연도를 지정하면 그 해 행만 읽는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({ currentYear: 2026 });

      expect(argsOf(db.githubUserActivityHistory.findMany).where).toEqual({
        year: 2026,
      });
    });

    it('연도가 여러 해 있어도 요청한 해만 합산된다 (stale 연도 혼입 금지)', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([signup(1n, 'multi-year')]);
      // where 는 위 테스트가 고정하지만, 그래도 다른 해 행이 들어오면 접기
      // 단계에서 섞이지 않는지 본다 — 필터가 뚫려도 값이 오염되지 않아야 한다.
      db.githubUserActivityHistory.findMany.mockResolvedValue([
        observation(1n, 2026, { commitCount: 7, starCount: 3 }),
      ]);

      const result = await repositoryFor(db).findMetrics({ currentYear: 2026 });

      expect(result[0]).toMatchObject({ commitCount: 7, starCount: 3 });
    });
  });

  describe('allowlist 밖의 값을 읽지 않는다', () => {
    it('사람 축 조회는 명시적 select 만 쓰고 include 를 쓰지 않는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const args = argsOf(db.githubUserActivityHistory.findMany);
      // include 는 스키마에 칸이 늘 때 조용히 같이 새어 나간다.
      expect(args).not.toHaveProperty('include');
      expect(Object.keys(args.select ?? {}).sort()).toEqual([
        'commitCount',
        'githubId',
        'issueCount',
        'pullRequestCount',
        'repositoryCount',
        'starCount',
        'year',
      ]);
    });

    it('사용자 조회는 명시적 select 만 쓰고 실명(name)을 읽지 않는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const args = argsOf(db.user.findMany);
      expect(args).not.toHaveProperty('include');
      // 이 값이 인증 없는 공개 응답으로 그대로 나간다.
      // 동의 철회 endpoint 가 없는 상태에서 실명 노출은 되돌릴 수 없다.
      expect(args.select).toEqual({
        githubId: true,
        nickname: true,
        department: true,
        profile: { select: { department: true } },
      });
      expect(args.select).not.toHaveProperty('name');
      expect(args.select).not.toHaveProperty('email');
      expect(
        (args.select?.['profile'] as { select: Record<string, unknown> })
          .select,
      ).not.toHaveProperty('name');
    });

    it('DB 에 실명이 있어도 응답에는 새어 나가지 않는다', async () => {
      const db = createDb();
      // Prisma 는 select 밖의 칸을 돌려주지 않지만, 만약 돌려주더라도 이
      // repository 가 DTO allowlist 밖의 값을 통과시키지 않는다는 증명이다.
      db.user.findMany.mockResolvedValue([
        { ...signup(1n, 'octo-cat', '컴퓨터정보통신공학과'), name: '홍길동' },
      ]);

      const result = await repositoryFor(db).findMetrics({});

      const serialized = JSON.stringify(
        result,
        (_key: string, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).not.toContain('홍길동');
      expect(result[0]).not.toHaveProperty('name');
      expect(Object.keys(result[0] ?? {}).sort()).toEqual([
        'commitCount',
        'department',
        'githubId',
        'githubLogin',
        'issueCount',
        'pullRequestCount',
        'repositoryCount',
        'starCount',
      ]);
    });
  });

  describe('가입한 모든 사용자가 노출된다 (PM 확정 정책)', () => {
    it('관측 행이 하나도 없는 신규 User 도 5종 0으로 포함된다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        signup(1n, 'fresh-signup', '전자공학과'),
      ]);
      db.githubUserActivityHistory.findMany.mockResolvedValue([]);

      const result = await repositoryFor(db).findMetrics({ currentYear: 2026 });

      expect(result).toEqual([
        {
          githubId: 1n,
          githubLogin: 'fresh-signup',
          department: '전자공학과',
          commitCount: 0,
          pullRequestCount: 0,
          issueCount: 0,
          repositoryCount: 0,
          starCount: 0,
        },
      ]);
    });

    it('nickname 이 없는 사용자는 제외한다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        signup(3n, null),
        signup(4n, 'has-login'),
      ]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result.map((entry) => entry.githubId)).toEqual([4n]);
    });
  });

  describe('학과는 UserProfile 을 우선한다 (실명은 읽지 않는다)', () => {
    it('UserProfile 만 있는 사용자도 학과가 채워진다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        signup(1n, 'profile-only', null, '소프트웨어공학과'),
      ]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result[0]?.department).toBe('소프트웨어공학과');
    });

    it('UserProfile 이 없으면 legacy User.department 로 떨어진다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        signup(2n, 'legacy-only', '지능형모빌리티융합학과'),
      ]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result[0]?.department).toBe('지능형모빌리티융합학과');
    });

    it('둘 다 없으면 null 이다 — 빈 값을 지어내지 않는다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([signup(3n, 'no-department')]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result[0]?.department).toBeNull();
    });
  });

  describe('실명은 교직원·관리자 계층에서만 질의된다 (redact-later 금지)', () => {
    it('includeRealName 을 주지 않으면 생성되는 select 에 name 이 아예 없다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({ currentYear: 2026 });

      const select = argsOf(db.user.findMany).select ?? {};
      // "가져온 뒤 지우기"가 아니라 질의 자체에 컬럼이 없어야 한다.
      // (`nickname` 은 문자열로 'name' 을 포함하므로 키 단위로 본다.)
      expect(Object.keys(select).sort()).toEqual([
        'department',
        'githubId',
        'nickname',
        'profile',
      ]);
      expect(select).not.toHaveProperty('name');
      expect(
        (select['profile'] as { select: Record<string, unknown> }).select,
      ).not.toHaveProperty('name');
    });

    it('includeRealName: false 도 같다 — 학생 세션은 비로그인과 바이트 동일하다', async () => {
      const db = createDb();
      const anonymousDb = createDb();

      await repositoryFor(db).findMetrics({
        currentYear: 2026,
        includeRealName: false,
      });
      await repositoryFor(anonymousDb).findMetrics({ currentYear: 2026 });

      expect(argsOf(db.user.findMany).select).toEqual(
        argsOf(anonymousDb.user.findMany).select,
      );
    });

    it('includeRealName: true 일 때만 name 컬럼이 select 에 붙는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({
        currentYear: 2026,
        includeRealName: true,
      });

      const args = argsOf(db.user.findMany);
      expect(args).not.toHaveProperty('include');
      // 학과는 그대로 읽고 실명 한 칸만 더한다 — 2차 조회를 만들지 않는다.
      expect(args.select).toEqual({
        githubId: true,
        nickname: true,
        name: true,
        department: true,
        profile: { select: { name: true, department: true } },
      });
      // 같은 사실을 두 번 읽지 않는다 — user 조회는 여전히 한 번이다.
      expect(db.user.findMany).toHaveBeenCalledTimes(1);
    });

    it('교직원 계층은 UserProfile 실명을 우선하고 없으면 legacy User.name 으로 떨어진다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        {
          githubId: 1n,
          nickname: 'profile-named',
          name: 'legacy-name',
          department: null,
          profile: { name: 'profile-name', department: null },
        },
        {
          githubId: 2n,
          nickname: 'legacy-named',
          name: 'legacy-name-2',
          department: null,
          profile: null,
        },
        {
          githubId: 3n,
          nickname: 'nameless',
          name: null,
          department: null,
          profile: null,
        },
      ]);

      const result = await repositoryFor(db).findMetrics({
        includeRealName: true,
      });

      expect(result.map((entry) => entry.realName)).toEqual([
        'profile-name',
        'legacy-name-2',
        null,
      ]);
    });

    it('실명을 물지 않은 결과에는 realName 칸 자체가 없다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([signup(1n, 'octo-cat')]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result[0]).not.toHaveProperty('realName');
    });
  });

  describe('집계', () => {
    it('사람 축 관측을 사용자별로 LEFT JOIN 한다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        signup(1n, 'alice'),
        signup(2n, 'bob'),
      ]);
      db.githubUserActivityHistory.findMany.mockResolvedValue([
        observation(1n, 2026, {
          commitCount: 5,
          pullRequestCount: 1,
          issueCount: 2,
          repositoryCount: 3,
          starCount: 40,
        }),
      ]);

      const result = await repositoryFor(db).findMetrics({ currentYear: 2026 });

      expect(result).toEqual([
        {
          githubId: 1n,
          githubLogin: 'alice',
          department: null,
          commitCount: 5,
          pullRequestCount: 1,
          issueCount: 2,
          repositoryCount: 3,
          starCount: 40,
        },
        {
          githubId: 2n,
          githubLogin: 'bob',
          department: null,
          commitCount: 0,
          pullRequestCount: 0,
          issueCount: 0,
          repositoryCount: 0,
          starCount: 0,
        },
      ]);
    });

    it('연도를 지정하지 않으면 흐름 지표는 더하고 star 는 최신 연도 값을 쓴다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([signup(1n, 'veteran')]);
      db.githubUserActivityHistory.findMany.mockResolvedValue([
        observation(1n, 2025, {
          commitCount: 10,
          pullRequestCount: 2,
          issueCount: 1,
          repositoryCount: 4,
          starCount: 30,
        }),
        observation(1n, 2026, {
          commitCount: 5,
          pullRequestCount: 3,
          issueCount: 2,
          repositoryCount: 6,
          starCount: 50,
        }),
      ]);

      const result = await repositoryFor(db).findMetrics({});

      // star 는 그 시점 누적이라 연도별로 더하면 같은 별을 두 번 센다.
      expect(result[0]).toEqual({
        githubId: 1n,
        githubLogin: 'veteran',
        department: null,
        commitCount: 15,
        pullRequestCount: 5,
        issueCount: 3,
        repositoryCount: 10,
        starCount: 50,
      });
    });

    it('연도를 지정하지 않으면 기간 필터를 걸지 않는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      expect(argsOf(db.githubUserActivityHistory.findMany).where).toEqual({});
    });
  });

  describe('연도 목록과 기준 시각', () => {
    it('사람 축 year 에서 연도를 뽑아 최신 순으로 돌려준다', async () => {
      const db = createDb();
      db.githubUserActivityHistory.findMany.mockResolvedValue([
        { year: 2025 },
        { year: 2026 },
      ]);

      await expect(repositoryFor(db).listYears()).resolves.toEqual([
        2026, 2025,
      ]);
      const args = argsOf(db.githubUserActivityHistory.findMany);
      expect(args.select).toEqual({ year: true });
      expect(args.distinct).toEqual(['year']);
    });

    it('기준 시각은 마지막 사람 축 관측 시각이다', async () => {
      const db = createDb();
      const observedAt = new Date('2026-08-19T02:00:00.000Z');
      db.githubUserActivityHistory.aggregate.mockResolvedValue({
        _max: { observedAt },
      });

      await expect(repositoryFor(db).findDataAsOf()).resolves.toEqual(
        observedAt,
      );
    });

    it('관측이 하나도 없으면 기준 시각은 null 이다', async () => {
      const db = createDb();

      await expect(repositoryFor(db).findDataAsOf()).resolves.toBeNull();
    });
  });
});
