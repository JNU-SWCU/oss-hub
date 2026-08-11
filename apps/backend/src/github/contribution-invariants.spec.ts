import { ContributionInvariants } from './contribution-invariants';
import type {
  ContributionInvariantReport,
  ContributionInvariantResult,
} from './contribution-invariants';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 불변식 검사 자체가 실제로 위반을 잡는지 검증한다.
 *
 * 검사기는 "통과"를 만들기 쉽다 — 아무것도 안 보면 항상 통과한다.
 * 그래서 각 불변식마다 **깨진 입력을 주고 잡히는지**를 함께 본다.
 */

interface MockPrisma {
  contribution: {
    groupBy: jest.Mock;
    findMany: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  user: { findMany: jest.Mock };
  collectionCommitFact: { count: jest.Mock };
  collectionPullRequestFact: { count: jest.Mock };
  collectionReleaseFact: { count: jest.Mock };
}

/** 기본은 "전부 깨끗한 빈 DB". 각 테스트가 필요한 것만 어긋뜨린다. */
const createDb = (): MockPrisma => ({
  contribution: {
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({
      _sum: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
    }),
    count: jest.fn().mockResolvedValue(0),
  },
  user: { findMany: jest.fn().mockResolvedValue([]) },
  collectionCommitFact: { count: jest.fn().mockResolvedValue(0) },
  collectionPullRequestFact: { count: jest.fn().mockResolvedValue(0) },
  collectionReleaseFact: { count: jest.fn().mockResolvedValue(0) },
});

const invariantsFor = (db: MockPrisma): ContributionInvariants =>
  new ContributionInvariants(db as unknown as PrismaService);

const resultNamed = (
  report: ContributionInvariantReport,
  name: string,
): ContributionInvariantResult | undefined =>
  report.results.find((result) => result.name === name);

describe('ContributionInvariants', () => {
  it('깨끗한 상태에서는 네 불변식이 모두 통과한다', async () => {
    const report = await invariantsFor(createDb()).check();

    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(4);
    expect(report.results.every((result) => result.violationCount === 0)).toBe(
      true,
    );
  });

  describe('불변식 1 — 입자 중복 0', () => {
    it('같은 (저장소, 사람, 날짜) 가 두 번 나오면 잡는다', async () => {
      const db = createDb();
      db.contribution.groupBy.mockResolvedValue([
        { repositoryId: 'repo-1', githubId: 1n, date: new Date() },
      ]);

      const report = await invariantsFor(db).check();

      expect(report.ok).toBe(false);
      expect(resultNamed(report, '입자 중복 0')?.ok).toBe(false);
    });
  });

  describe('불변식 2 — 가입자만 적재', () => {
    it('가입자가 아닌 기여자가 있으면 잡는다', async () => {
      const db = createDb();
      db.contribution.findMany.mockResolvedValue([
        { githubId: 1n },
        { githubId: 999n },
      ]);
      // 1n 만 가입자다.
      db.user.findMany.mockResolvedValue([{ githubId: 1n }]);

      const report = await invariantsFor(db).check();

      const result = resultNamed(report, '가입자만 적재');
      expect(result?.ok).toBe(false);
      expect(result?.violationCount).toBe(1);
    });

    it('보고에 학생 식별자를 담지 않는다', async () => {
      const db = createDb();
      db.contribution.findMany.mockResolvedValue([{ githubId: 424242n }]);
      db.user.findMany.mockResolvedValue([]);

      const report = await invariantsFor(db).check();

      // 이 보고가 공개 로그·이슈로 갈 수 있다(AGENTS.md §6).
      expect(resultNamed(report, '가입자만 적재')?.ok).toBe(false);
      expect(JSON.stringify(report)).not.toContain('424242');
    });

    it('기여자가 전원 가입자면 통과한다', async () => {
      const db = createDb();
      db.contribution.findMany.mockResolvedValue([
        { githubId: 1n },
        { githubId: 2n },
      ]);
      db.user.findMany.mockResolvedValue([{ githubId: 1n }, { githubId: 2n }]);

      const report = await invariantsFor(db).check();

      expect(resultNamed(report, '가입자만 적재')?.ok).toBe(true);
    });
  });

  describe('불변식 3 — 내부 합계 정합', () => {
    it('집계 합계가 fact 건수보다 크면 잡는다', async () => {
      const db = createDb();
      db.contribution.aggregate.mockResolvedValue({
        _sum: { commitCount: 10, pullRequestCount: 0, releaseCount: 0 },
      });
      // fact 에는 5건뿐인데 집계가 10을 말한다 — 근거 없는 행이 있다.
      db.collectionCommitFact.count.mockResolvedValue(5);

      const report = await invariantsFor(db).check();

      expect(resultNamed(report, '내부 합계 정합')?.ok).toBe(false);
    });

    it('가입자 필터 때문에 집계가 fact 보다 작은 것은 정상이다', async () => {
      const db = createDb();
      db.contribution.aggregate.mockResolvedValue({
        _sum: { commitCount: 3, pullRequestCount: 0, releaseCount: 0 },
      });
      // fact 10건 중 7건이 미가입자 것이라 집계에는 3건만 남았다.
      db.collectionCommitFact.count.mockResolvedValue(10);

      const report = await invariantsFor(db).check();

      expect(resultNamed(report, '내부 합계 정합')?.ok).toBe(true);
    });
  });

  describe('불변식 4 — 음수 없음', () => {
    it('음수 집계가 있으면 잡는다', async () => {
      const db = createDb();
      db.contribution.count.mockResolvedValue(2);

      const report = await invariantsFor(db).check();

      const result = resultNamed(report, '음수 없음(멱등성 대리)');
      expect(result?.ok).toBe(false);
      expect(result?.violationCount).toBe(2);
    });
  });

  it('읽기 전용이다 — 어긋난 것을 고치지 않는다', async () => {
    const db = createDb();
    db.contribution.groupBy.mockResolvedValue([
      { repositoryId: 'repo-1', githubId: 1n, date: new Date() },
    ]);

    await invariantsFor(db).check();

    // 자동 교정은 원인을 덮는다. 이 검사의 목적은 원인을 드러내는 것이다.
    const mutating = ['upsert', 'update', 'delete', 'deleteMany', 'createMany'];
    for (const method of mutating) {
      expect(
        (db.contribution as unknown as Record<string, unknown>)[method],
      ).toBeUndefined();
    }
  });
});
