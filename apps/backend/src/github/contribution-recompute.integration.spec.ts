import { PrismaClient } from '@prisma/client';

import { CollectionIncrementalRepository } from './repository/collection-incremental.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { PrismaService } from '../prisma/prisma.service';

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
    await repository.recordCommitFacts(
      REPO_ID,
      [
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
      ],
      await repository.listRegisteredGithubIds(),
    );

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

  it('Issue도 KST 자정에서 날짜가 갈린다 — 14:59:59Z 는 그날, 15:00:00Z 는 다음 날이다', async () => {
    await repository.recordIssueFacts(
      REPO_ID,
      [
        {
          githubIssueId: 1n,
          state: 'open',
          createdAt: new Date('2026-03-15T14:59:59.000Z'),
          authorGithubId: MEMBER,
        },
        {
          githubIssueId: 2n,
          state: 'closed',
          createdAt: new Date('2026-03-15T15:00:00.000Z'),
          authorGithubId: MEMBER,
        },
      ],
      await repository.listRegisteredGithubIds(),
    );

    const rows = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      orderBy: { date: 'asc' },
      select: { date: true, commitCount: true, issueCount: true },
    });

    expect(
      rows.map((row) => [
        row.date.toISOString().slice(0, 10),
        row.commitCount,
        row.issueCount,
      ]),
    ).toEqual([
      ['2026-03-15', 0, 1],
      ['2026-03-16', 0, 1],
    ]);
  });

  it('커밋만 다시 센 재계산도 같은 칸의 issueCount 를 지우지 않는다', async () => {
    const registeredGithubIds = await repository.listRegisteredGithubIds();
    await repository.recordIssueFacts(
      REPO_ID,
      [
        {
          githubIssueId: 1n,
          state: 'open',
          createdAt: new Date('2026-03-15T01:00:00.000Z'),
          authorGithubId: MEMBER,
        },
      ],
      registeredGithubIds,
    );

    await repository.recordCommitFacts(
      REPO_ID,
      [
        {
          sha: 'same-day-commit',
          committedAt: new Date('2026-03-15T02:00:00.000Z'),
          authorGithubId: MEMBER,
        },
      ],
      registeredGithubIds,
    );

    const rows = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { commitCount: true, issueCount: true },
    });
    expect(rows).toEqual([{ commitCount: 1, issueCount: 1 }]);
  });

  it('미가입자 기여는 행이 만들어지지 않는다', async () => {
    await repository.recordCommitFacts(
      REPO_ID,
      [
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
      ],
      await repository.listRegisteredGithubIds(),
    );

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

    const registeredGithubIds = await repository.listRegisteredGithubIds();
    await repository.recordCommitFacts(REPO_ID, batch, registeredGithubIds);
    const first = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { githubId: true, date: true, commitCount: true },
    });

    await repository.recordCommitFacts(REPO_ID, batch, registeredGithubIds);
    const second = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { githubId: true, date: true, commitCount: true },
    });

    expect(second).toEqual(first);
    expect(second[0]?.commitCount).toBe(2);
  });

  it('상류에서 fact 가 사라지면 그 칸도 사라진다 — 0 인 행을 남기지 않는다', async () => {
    const registeredGithubIds = await repository.listRegisteredGithubIds();
    await repository.recordCommitFacts(
      REPO_ID,
      [
        {
          sha: 'will-disappear',
          committedAt: new Date('2026-03-15T01:00:00.000Z'),
          authorGithubId: MEMBER,
        },
      ],
      registeredGithubIds,
    );
    expect(
      await prisma.contribution.count({ where: { repositoryId: REPO_ID } }),
    ).toBe(1);

    await prisma.collectionCommitFact.deleteMany({
      where: { repositoryId: REPO_ID },
    });

    await repository.recordCommitFacts(
      REPO_ID,
      [
        {
          sha: 'will-disappear',
          committedAt: new Date('2026-03-15T01:00:00.000Z'),
          authorGithubId: MEMBER,
        },
      ],
      registeredGithubIds,
    );
    await prisma.collectionCommitFact.deleteMany({
      where: { repositoryId: REPO_ID },
    });
    await repository.recordCommitFacts(
      REPO_ID,
      [
        {
          sha: 'unrelated-same-day',
          committedAt: new Date('2026-03-15T03:00:00.000Z'),
          authorGithubId: MEMBER,
        },
      ],
      registeredGithubIds,
    );

    const rows = await prisma.contribution.findMany({
      where: { repositoryId: REPO_ID },
      select: { commitCount: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.commitCount).toBe(1);
  });

  it('칸이 늘어도 질의 수가 늘지 않는다 — 트랜잭션 안 N+1 을 만들지 않는다', async () => {
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

    await loggedRepository.recordCommitFacts(
      REPO_ID,
      facts,
      await loggedRepository.listRegisteredGithubIds(),
    );
    await logged.$disconnect();

    const rows = await prisma.contribution.count({
      where: { repositoryId: REPO_ID },
    });
    expect(rows).toBe(60);

    const dataQueries = queries.filter(
      (query) => !/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/u.test(query.trim()),
    );
    expect(dataQueries.length).toBeLessThan(15);
  });
});

describe('수집 편입 큐 백오프 (실 Postgres)', () => {
  const prisma = new PrismaClient();
  const repository = new CollectionIncrementalRepository(
    prisma as unknown as PrismaService,
  );

  const QUEUE_REPO_ID = 'queue-backoff-repo';
  const QUEUE_GITHUB_ID = 9_930_000_001n;

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.githubRepository.deleteMany({
      where: { githubRepositoryId: QUEUE_GITHUB_ID },
    });
    await prisma.githubRepository.create({
      data: {
        id: QUEUE_REPO_ID,
        githubRepositoryId: QUEUE_GITHUB_ID,
        nameWithOwner: 'queue-backoff/synthetic',
        source: 'ORG_PROVISIONED',
        visibility: 'PUBLIC',
        presence: 'PRESENT',
      },
    });
  });

  it('새 행은 기본값으로 즉시 수집 대상이다 — 행의 존재가 곧 멤버십이다', async () => {
    const row = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: QUEUE_GITHUB_ID },
      select: { nextRunAt: true, failureCount: true, lastSuccessAt: true },
    });

    expect(row.failureCount).toBe(0);
    expect(row.lastSuccessAt).toBeNull();

    expect(row.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('실패는 차례를 뒤로 밀고 성공은 즉시 되돌린다', async () => {
    const at = new Date('2026-05-01T00:00:00.000Z');

    await repository.recordRepositoryFailure(QUEUE_GITHUB_ID, at);
    const failed = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: QUEUE_GITHUB_ID },
      select: { nextRunAt: true, failureCount: true },
    });
    expect(failed.failureCount).toBe(1);

    expect(failed.nextRunAt.getTime()).toBeGreaterThan(at.getTime());

    await repository.recordRepositoryFailure(QUEUE_GITHUB_ID, at);
    const twice = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: QUEUE_GITHUB_ID },
      select: { nextRunAt: true, failureCount: true },
    });

    expect(twice.failureCount).toBe(2);
    expect(twice.nextRunAt.getTime()).toBeGreaterThan(
      failed.nextRunAt.getTime(),
    );

    await repository.recordRepositorySuccess(QUEUE_GITHUB_ID, at);
    const healed = await prisma.githubRepository.findUniqueOrThrow({
      where: { githubRepositoryId: QUEUE_GITHUB_ID },
      select: { nextRunAt: true, failureCount: true, lastSuccessAt: true },
    });

    expect(healed.failureCount).toBe(0);
    expect(healed.lastSuccessAt?.getTime()).toBe(at.getTime());
    expect(healed.nextRunAt.getTime()).toBe(at.getTime());
  });
});
