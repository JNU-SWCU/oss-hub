import { PrismaClient } from '@prisma/client';

import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * `Contribution` 재계산을 **실 Postgres** 로 검증한다 (ADR-010 §4·§5·§9).
 *
 * 단위 스펙은 Prisma 를 mock 하므로 집합 SQL 이 실제로 무엇을 넣는지 볼 수 없다.
 * 특히 두 가지는 mock 으로 절대 잡히지 않는다.
 *
 * 1. **날짜 경계** — 쓰기는 `AT TIME ZONE 'Asia/Seoul'` 로 접고 읽기는 UTC 경계로
 *    자른다. 한쪽이라도 어긋나면 연말·연초 하루가 통째로 밀린다.
 * 2. **질의 횟수** — 칸이 늘어도 질의가 늘지 않아야 한다. 늘어나면 checkpoint
 *    트랜잭션(기본 5초)을 넘겨 fact 적재까지 함께 롤백된다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

describe('Contribution 재계산 (실 Postgres)', () => {
  const prisma = new PrismaClient();
  const repository = new CollectionIncrementalRepository(
    prisma as unknown as PrismaService,
  );

  const PREFIX = 'contrib-recompute';
  const REPO_ID = `${PREFIX}-repo`;
  const GITHUB_REPO_ID = 9_910_000_001n;
  const MEMBER = 9_920_000_001n;
  const STRANGER = 9_920_000_999n;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.contribution.deleteMany({ where: { repositoryId: REPO_ID } });
    await prisma.collectionCommitFact.deleteMany({
      where: { repositoryId: REPO_ID },
    });
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: GITHUB_REPO_ID },
    });
    await prisma.user.deleteMany({ where: { githubId: MEMBER } });

    await prisma.githubRepository.create({
      data: {
        id: REPO_ID,
        githubRepositoryId: GITHUB_REPO_ID,
        nameWithOwner: `${PREFIX}/synthetic`,
        source: 'ORG_PROVISIONED',
        visibility: 'PUBLIC',
        presence: 'PRESENT',
      },
    });
    await prisma.user.create({
      data: {
        id: `${PREFIX}-user`,
        githubId: MEMBER,
        nickname: `${PREFIX}-member`,
      },
    });
  });

  it('KST 자정 경계를 사이에 둔 두 커밋이 서로 다른 날짜 칸으로 간다', async () => {
    // 둘 다 UTC 로는 2026-03-15 지만 KST 로는 하루가 갈린다.
    await repository.recordCommitFacts(REPO_ID, [
      {
        sha: 'before-kst-midnight',
        committedAt: new Date('2026-03-15T14:30:00.000Z'),
        authorGithubId: MEMBER,
      },
      {
        sha: 'after-kst-midnight',
        committedAt: new Date('2026-03-15T15:30:00.000Z'),
        authorGithubId: MEMBER,
      },
    ]);

    const rows = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      orderBy: { date: 'asc' },
      select: { date: true, commitCount: true },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.date.toISOString().slice(0, 10)).toBe('2026-03-15');
    expect(rows[1]?.date.toISOString().slice(0, 10)).toBe('2026-03-16');
    expect(rows.every((row) => row.commitCount === 1)).toBe(true);
  });

  it('미가입자 기여는 행이 만들어지지 않는다', async () => {
    await repository.recordCommitFacts(REPO_ID, [
      {
        sha: 'by-member',
        committedAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER,
      },
      {
        sha: 'by-stranger',
        committedAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: STRANGER,
      },
    ]);

    const rows = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { githubId: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.githubId).toBe(MEMBER);
  });

  it('재실행해도 같은 값이다 — 누적이 아니라 덮어쓰기다', async () => {
    const batch = [
      {
        sha: 'idempotent-a',
        committedAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER,
      },
      {
        sha: 'idempotent-b',
        committedAt: new Date('2026-03-15T02:00:00.000Z'),
        authorGithubId: MEMBER,
      },
    ];

    await repository.recordCommitFacts(REPO_ID, batch);
    const first = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { githubId: true, date: true, commitCount: true },
    });

    // 같은 배치를 다시 넣는다. fact 는 skipDuplicates 라 늘지 않고,
    // 집계는 COUNT 재계산이라 같은 값이어야 한다.
    await repository.recordCommitFacts(REPO_ID, batch);
    const second = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { githubId: true, date: true, commitCount: true },
    });

    expect(second).toEqual(first);
    expect(second[0]?.commitCount).toBe(2);
  });

  it('상류에서 fact 가 사라지면 그 칸도 사라진다 — 0 인 행을 남기지 않는다', async () => {
    await repository.recordCommitFacts(REPO_ID, [
      {
        sha: 'will-disappear',
        committedAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER,
      },
    ]);
    expect(
      await prisma.contribution.count({ where: { repositoryId: REPO_ID } }),
    ).toBe(1);

    // force-push 로 fact 가 사라진 상황을 만든다.
    await prisma.collectionCommitFact.deleteMany({
      where: { repositoryId: REPO_ID },
    });
    // 같은 칸을 다시 건드리는 재계산이 돌면 0 인 행이 아니라 행 자체가 없어야 한다.
    await repository.recordCommitFacts(REPO_ID, [
      {
        sha: 'will-disappear',
        committedAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER,
      },
    ]);
    await prisma.collectionCommitFact.deleteMany({
      where: { repositoryId: REPO_ID },
    });
    await repository.recordCommitFacts(REPO_ID, [
      {
        sha: 'unrelated-same-day',
        committedAt: new Date('2026-03-15T03:00:00.000Z'),
        authorGithubId: MEMBER,
      },
    ]);

    const rows = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { commitCount: true },
    });
    // 남은 fact 는 마지막 하나뿐이므로 값이 1이며, 사라진 것이 누적되지 않았다.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.commitCount).toBe(1);
  });

  it('칸이 늘어도 질의 수가 늘지 않는다 — 트랜잭션 안 N+1 을 만들지 않는다', async () => {
    // 60일 × 1명 = 60칸. 셀 단위 루프였다면 count×3 + upsert 로 240 질의였다.
    const facts = Array.from({ length: 60 }, (_, index) => ({
      sha: `bulk-${index}`,
      committedAt: new Date(Date.UTC(2026, 4, 1 + index, 3, 0, 0)),
      authorGithubId: MEMBER,
    }));

    const queries: string[] = [];
    const spy = (event: { query: string }): void => {
      queries.push(event.query);
    };
    const logged = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    logged.$on('query' as never, spy);
    const loggedRepository = new CollectionIncrementalRepository(
      logged as unknown as PrismaService,
    );

    await loggedRepository.recordCommitFacts(REPO_ID, facts);
    await logged.$disconnect();

    const rows = await prisma.contribution.count({
      where: { repositoryId: REPO_ID },
    });
    expect(rows).toBe(60);

    // 삽입 1 + 가입자 조회 1 + 삭제 1 + 집합 insert 1 (+ 트랜잭션 프레임).
    // 칸 수(60)에 비례해 늘지 않는다는 것이 요점이다.
    const dataQueries = queries.filter(
      (query) => !/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/u.test(query.trim()),
    );
    expect(dataQueries.length).toBeLessThan(15);
  });
});
