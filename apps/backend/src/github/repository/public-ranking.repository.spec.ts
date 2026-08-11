import { PublicRankingRepository } from './public-ranking.repository';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 공개 랭킹 strict-read 계약 (`AGENTS.md` §4 · ADR-003).
 *
 * 랭킹 endpoint 에는 인증 가드가 없는데 읽는 대상은 private 테이블이다.
 * 그 조합이 허용되는 유일한 경로가 이 repository 이므로, 여기서 지켜야 하는
 * 것들을 테스트가 직접 잡는다 — 코드 리뷰에만 맡기지 않는다.
 *
 * PM 확정 정책(2026-08) — 가입한 모든 사용자가 노출되고(기여 없으면 0/0/0),
 * 집계 범위는 visibility 무관 JNU-SWCU org 저장소 전체로 넓어졌다. `findMetrics`
 * 는 이제 `User` 에서 시작해 `Contribution` 을 애플리케이션 레벨에서 LEFT
 * JOIN 한다(FK 가 아니라 githubId 값 조인이라 Prisma relation include 가 안
 * 된다) — 아래 테스트는 그 계약을 고정한다.
 */

/** Prisma 호출 인자를 구조로 본다 — any 로 두면 계약 검사가 무의미해진다. */
interface FindManyArgs {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  include?: unknown;
}

interface MockPrisma {
  contribution: { findMany: jest.Mock<Promise<unknown[]>, [FindManyArgs]> };
  githubRepository: {
    aggregate: jest.Mock<
      Promise<{ _max: { lastSuccessAt: Date | null } }>,
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
    Promise<{ _max: { lastSuccessAt: Date | null } }>,
    [FindManyArgs]
  >();
  aggregate.mockResolvedValue({ _max: { lastSuccessAt: null } });
  const userFindMany = jest.fn<Promise<unknown[]>, [FindManyArgs]>();
  userFindMany.mockResolvedValue([]);
  return {
    contribution: { findMany },
    githubRepository: { aggregate },
    user: { findMany: userFindMany },
  };
};

const repositoryFor = (db: MockPrisma): PublicRankingRepository =>
  new PublicRankingRepository(db as unknown as PrismaService);

const RANKING_REPOSITORY_SCOPE = {
  presence: 'PRESENT',
  OR: [
    { source: 'ORG_PROVISIONED' },
    { source: 'EXTERNAL_PUBLIC', visibility: 'PUBLIC' },
  ],
};

describe('PublicRankingRepository — 공개 strict-read 계약', () => {
  describe('저장소 범위는 호출자가 바꿀 수 없다', () => {
    it('org 저장소는 visibility 와 무관하게, 개인(EXTERNAL_PUBLIC) 저장소는 PUBLIC 일 때만 조회한다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      expect(argsOf(db.contribution.findMany).where?.repository).toEqual(
        RANKING_REPOSITORY_SCOPE,
      );
    });

    it('연도 목록과 갱신 시각이 같은 저장소 범위를 쓴다', async () => {
      const db = createDb();

      await repositoryFor(db).listYears();
      await repositoryFor(db).findDataAsOf();

      // 연도 목록은 기여를 통해, 갱신 시각은 저장소를 통해 같은 조건을 건다.
      expect(argsOf(db.contribution.findMany).where?.repository).toEqual(
        RANKING_REPOSITORY_SCOPE,
      );
      // 갱신 시각은 "마지막 수집 성공"이라 저장소 행을 본다(ADR-010 §10).
      expect(argsOf(db.githubRepository.aggregate).where).toEqual(
        RANKING_REPOSITORY_SCOPE,
      );
    });
  });

  describe('source 별로 visibility 규칙이 다르다 (동의 문서 경계)', () => {
    it('ORG_PROVISIONED + visibility: PRIVATE 저장소의 기여가 합산된다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const repository = argsOf(db.contribution.findMany).where?.repository as
        | Record<string, unknown>
        | undefined;
      const or = repository?.['OR'] as Record<string, unknown>[];
      // org 갈래에는 visibility 조건이 없다 — PRIVATE 저장소 기여도 이 조건을
      // 통과해 합산된다.
      expect(or).toContainEqual({ source: 'ORG_PROVISIONED' });
    });

    it('EXTERNAL_PUBLIC + visibility: PRIVATE 저장소의 기여가 제외된다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const repository = argsOf(db.contribution.findMany).where?.repository as
        | Record<string, unknown>
        | undefined;
      const or = repository?.['OR'] as Record<string, unknown>[];
      const externalBranch = or.find(
        (clause) => clause['source'] === 'EXTERNAL_PUBLIC',
      );
      // 개인(EXTERNAL_PUBLIC) 갈래는 visibility: 'PUBLIC' 을 반드시 요구한다 —
      // PRIVATE 저장소는 두 OR 갈래 어디에도 매치하지 않아 제외된다(동의
      // 문서 「수집 범위와 목적」이 개인 비공개 저장소를 배제한다).
      expect(externalBranch).toEqual({
        source: 'EXTERNAL_PUBLIC',
        visibility: 'PUBLIC',
      });
    });

    it('EXTERNAL_PUBLIC + visibility: PUBLIC 저장소의 기여가 합산된다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const repository = argsOf(db.contribution.findMany).where?.repository as
        | Record<string, unknown>
        | undefined;
      const or = repository?.['OR'] as Record<string, unknown>[];
      expect(or).toContainEqual({
        source: 'EXTERNAL_PUBLIC',
        visibility: 'PUBLIC',
      });
    });
  });

  describe('allowlist 밖의 값을 읽지 않는다', () => {
    it('기여 조회는 명시적 select 만 쓰고 include 를 쓰지 않는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const args = argsOf(db.contribution.findMany);
      // include 는 스키마에 칸이 늘 때 조용히 같이 새어 나간다.
      expect(args).not.toHaveProperty('include');
      expect(Object.keys(args.select ?? {}).sort()).toEqual([
        'commitCount',
        'githubId',
        'pullRequestCount',
        'releaseCount',
      ]);
    });

    it('사용자 조회는 명시적 select 만 쓰고 실명(name)을 읽지 않는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const args = argsOf(db.user.findMany);
      expect(args).not.toHaveProperty('include');
      // 이 값이 인증 없는 공개 응답으로 그대로 나간다.
      // 동의 철회 endpoint 가 없는 상태에서 실명 노출은 되돌릴 수 없다.
      expect(args.select).toEqual({ githubId: true, nickname: true });
      expect(args.select).not.toHaveProperty('name');
      expect(args.select).not.toHaveProperty('email');
    });

    it('사용자 조회에 저장소 식별자를 select 하지 않는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const contributionArgs = argsOf(db.contribution.findMany);
      const selectKeys = Object.keys(contributionArgs.select ?? {});
      expect(selectKeys).not.toContain('repository');
      expect(selectKeys).not.toContain('repositoryId');
    });
  });

  describe('가입한 모든 사용자가 노출된다 (PM 확정 정책)', () => {
    it('Contribution 행이 하나도 없는 신규 User 도 0/0/0으로 포함된다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        { githubId: 1n, nickname: 'fresh-signup' },
      ]);
      db.contribution.findMany.mockResolvedValue([]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result).toEqual([
        {
          githubId: 1n,
          githubLogin: 'fresh-signup',
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ]);
    });

    it('PRIVATE org 저장소에만 기여한 사용자가 실제 수치로 나타난다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        { githubId: 2n, nickname: 'private-repo-contributor' },
      ]);
      // 저장소 필터는 mock 이 강제하지 않지만, 이 값이 나온다는 것 자체가
      // visibility 로 걸러지지 않는다는 뜻이다 — private repo 도 여기 포함된다.
      db.contribution.findMany.mockResolvedValue([
        { githubId: 2n, commitCount: 5, pullRequestCount: 2, releaseCount: 1 },
      ]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result).toEqual([
        {
          githubId: 2n,
          githubLogin: 'private-repo-contributor',
          commitCount: 5,
          pullRequestCount: 2,
          releaseCount: 1,
        },
      ]);
    });

    it('nickname 이 없는 사용자는 제외한다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        { githubId: 3n, nickname: null },
        { githubId: 4n, nickname: 'has-login' },
      ]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result.map((entry) => entry.githubId)).toEqual([4n]);
    });
  });

  describe('집계', () => {
    it('같은 사람의 여러 날짜 행을 하나로 접는다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        { githubId: 1n, nickname: 'alice' },
        { githubId: 2n, nickname: 'bob' },
      ]);
      db.contribution.findMany.mockResolvedValue([
        { githubId: 1n, commitCount: 2, pullRequestCount: 1, releaseCount: 0 },
        { githubId: 1n, commitCount: 3, pullRequestCount: 0, releaseCount: 1 },
        { githubId: 2n, commitCount: 1, pullRequestCount: 0, releaseCount: 0 },
      ]);

      const result = await repositoryFor(db).findMetrics({});

      expect(result).toEqual([
        {
          githubId: 1n,
          githubLogin: 'alice',
          commitCount: 5,
          pullRequestCount: 1,
          releaseCount: 1,
        },
        {
          githubId: 2n,
          githubLogin: 'bob',
          commitCount: 1,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ]);
    });

    it('연도를 지정하면 Asia/Seoul 연 경계로 자른다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({ currentYear: 2026 });

      const where = argsOf(db.contribution.findMany).where ?? {};
      // 저장에 연도 칸이 없으므로 날짜 범위로 자른다(ADR-010 §4).
      expect(where.date).toEqual({
        gte: new Date(Date.UTC(2026, 0, 1) - 9 * 60 * 60 * 1000),
        lt: new Date(Date.UTC(2027, 0, 1) - 9 * 60 * 60 * 1000),
      });
    });

    it('연도를 지정해도 기여 없는 사용자는 0/0/0으로 포함된다', async () => {
      const db = createDb();
      db.user.findMany.mockResolvedValue([
        { githubId: 5n, nickname: 'no-activity-this-year' },
      ]);
      db.contribution.findMany.mockResolvedValue([]);

      const result = await repositoryFor(db).findMetrics({ currentYear: 2026 });

      expect(result).toEqual([
        {
          githubId: 5n,
          githubLogin: 'no-activity-this-year',
          commitCount: 0,
          pullRequestCount: 0,
          releaseCount: 0,
        },
      ]);
    });

    it('연도를 지정하지 않으면 기간 필터를 걸지 않는다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      const where = argsOf(db.contribution.findMany).where ?? {};
      expect(where).not.toHaveProperty('date');
    });

    it('날짜에서 연도를 뽑아 최신 순으로 돌려준다', async () => {
      const db = createDb();
      db.contribution.findMany.mockResolvedValue([
        { date: new Date(Date.UTC(2025, 10, 20)) },
        { date: new Date(Date.UTC(2026, 4, 1)) },
        { date: new Date(Date.UTC(2026, 6, 1)) },
      ]);

      await expect(repositoryFor(db).listYears()).resolves.toEqual([
        2026, 2025,
      ]);
    });
  });
});
