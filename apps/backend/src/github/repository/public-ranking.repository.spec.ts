import { PublicRankingRepository } from './public-ranking.repository';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 공개 랭킹 strict-read 계약 (`AGENTS.md` §4 · ADR-003).
 *
 * 랭킹 endpoint 에는 인증 가드가 없는데 읽는 대상은 private 테이블이다.
 * 그 조합이 허용되는 유일한 경로가 이 repository 이므로, 여기서 지켜야 하는
 * 것들을 테스트가 직접 잡는다 — 코드 리뷰에만 맡기지 않는다.
 */

/** Prisma 호출 인자를 구조로 본다 — any 로 두면 계약 검사가 무의미해진다. */
interface FindManyArgs {
  where?: Record<string, unknown>;
  select?: Record<string, boolean>;
  include?: unknown;
}

interface MockPrisma {
  contribution: {
    findMany: jest.Mock<Promise<unknown[]>, [FindManyArgs]>;
    aggregate: jest.Mock<
      Promise<{ _max: { updatedAt: Date | null } }>,
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
    Promise<{ _max: { updatedAt: Date | null } }>,
    [FindManyArgs]
  >();
  aggregate.mockResolvedValue({ _max: { updatedAt: null } });
  const userFindMany = jest.fn<Promise<unknown[]>, [FindManyArgs]>();
  userFindMany.mockResolvedValue([]);
  return {
    contribution: { findMany, aggregate },
    user: { findMany: userFindMany },
  };
};

const repositoryFor = (db: MockPrisma): PublicRankingRepository =>
  new PublicRankingRepository(db as unknown as PrismaService);

describe('PublicRankingRepository — 공개 strict-read 계약', () => {
  describe('저장소 필터는 호출자가 바꿀 수 없다', () => {
    it('공개·관측 중 저장소로만 조회한다', async () => {
      const db = createDb();

      await repositoryFor(db).findMetrics({});

      expect(argsOf(db.contribution.findMany).where?.repository).toEqual({
        visibility: 'PUBLIC',
        presence: 'PRESENT',
      });
    });

    it('연도 목록과 갱신 시각도 같은 필터를 쓴다', async () => {
      const db = createDb();

      await repositoryFor(db).listYears();
      await repositoryFor(db).findDataAsOf();

      for (const args of [
        argsOf(db.contribution.findMany),
        argsOf(db.contribution.aggregate),
      ]) {
        expect(args.where?.repository).toEqual({
          visibility: 'PUBLIC',
          presence: 'PRESENT',
        });
      }
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

    it('사용자 조회에서 실명(name)을 읽지 않는다', async () => {
      const db = createDb();
      db.contribution.findMany.mockResolvedValue([
        { githubId: 1n, commitCount: 1, pullRequestCount: 0, releaseCount: 0 },
      ]);

      await repositoryFor(db).findMetrics({});

      const args = argsOf(db.user.findMany);
      // 이 값이 인증 없는 공개 응답으로 그대로 나간다.
      // 동의 철회 endpoint 가 없는 상태에서 실명 노출은 되돌릴 수 없다.
      expect(args.select).toEqual({ githubId: true, nickname: true });
      expect(args.select).not.toHaveProperty('name');
      expect(args.select).not.toHaveProperty('email');
    });
  });

  describe('집계', () => {
    it('같은 사람의 여러 날짜 행을 하나로 접는다', async () => {
      const db = createDb();
      db.contribution.findMany.mockResolvedValue([
        { githubId: 1n, commitCount: 2, pullRequestCount: 1, releaseCount: 0 },
        { githubId: 1n, commitCount: 3, pullRequestCount: 0, releaseCount: 1 },
        { githubId: 2n, commitCount: 1, pullRequestCount: 0, releaseCount: 0 },
      ]);
      db.user.findMany.mockResolvedValue([
        { githubId: 1n, nickname: 'alice' },
        { githubId: 2n, nickname: 'bob' },
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
