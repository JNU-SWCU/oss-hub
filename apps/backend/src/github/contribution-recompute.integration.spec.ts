import { PlatformRepository } from '../platform/platform.repository';
import { PrismaClient } from '@prisma/client';

import { CollectionIncrementalRepository } from './collection-incremental.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { PrismaService } from '../platform/prisma.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

describe('Contribution 재계산 (실 Postgres)', () => {
  const prisma = new PrismaClient();
  const repository = new CollectionIncrementalRepository(
    prisma as unknown as PrismaService,
    new PlatformRepository(),
  );

  interface ContributionDay {
    readonly githubId: bigint;
    readonly activityDate: Date;
    readonly commitCount: number;
    readonly issueCount: number;
  }

  const readDays = (): Promise<ContributionDay[]> =>
    prisma.$queryRaw<ContributionDay[]>`
      SELECT
        event.author_github_id AS "githubId",
        (event.occurred_at AT TIME ZONE 'Asia/Seoul')::date AS "activityDate",
        COUNT(*) FILTER (WHERE event.kind = 'commit')::int AS "commitCount",
        COUNT(*) FILTER (WHERE event.kind = 'issue')::int AS "issueCount"
      FROM "contribution" AS event
      WHERE event.repo_id = ${GITHUB_REPO_ID}
        AND event.author_github_id IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 2 ASC, 1 ASC
    `;

  const PREFIX = 'contrib-recompute';
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
    await prisma.contributionEvent.deleteMany({
      where: { repoId: GITHUB_REPO_ID },
    });
    await prisma.repo.deleteMany({ where: { githubRepoId: GITHUB_REPO_ID } });
    await prisma.user.deleteMany({ where: { githubId: MEMBER } });

    await prisma.repo.create({
      data: {
        githubRepoId: GITHUB_REPO_ID,
        ownerName: PREFIX,
        source: 'ORG_PROVISIONED',
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
    await repository.recordContributions(GITHUB_REPO_ID, 'commit', [
      {
        githubKey: 'before-kst-midnight',
        occurredAt: new Date('2026-03-15T14:30:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
      {
        githubKey: 'after-kst-midnight',
        occurredAt: new Date('2026-03-15T15:30:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
    ]);

    const rows = await readDays();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.activityDate.toISOString().slice(0, 10)).toBe('2026-03-15');
    expect(rows[1]?.activityDate.toISOString().slice(0, 10)).toBe('2026-03-16');
    expect(rows.every((row) => row.commitCount === 1)).toBe(true);
  });

  it('Issue도 KST 자정에서 날짜가 갈린다 — 14:59:59Z 는 그날, 15:00:00Z 는 다음 날이다', async () => {
    await repository.recordContributions(GITHUB_REPO_ID, 'issue', [
      {
        githubKey: '1',
        occurredAt: new Date('2026-03-15T14:59:59.000Z'),
        authorGithubId: MEMBER.toString(),
      },
      {
        githubKey: '2',
        occurredAt: new Date('2026-03-15T15:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
    ]);

    const rows = await readDays();

    expect(
      rows.map((row) => [
        row.activityDate.toISOString().slice(0, 10),
        row.commitCount,
        row.issueCount,
      ]),
    ).toEqual([
      ['2026-03-15', 0, 1],
      ['2026-03-16', 0, 1],
    ]);
  });

  it('커밋만 다시 센 재계산도 같은 칸의 issueCount 를 지우지 않는다', async () => {
    await repository.recordContributions(GITHUB_REPO_ID, 'issue', [
      {
        githubKey: '1',
        occurredAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
    ]);

    await repository.recordContributions(GITHUB_REPO_ID, 'commit', [
      {
        githubKey: 'same-day-commit',
        occurredAt: new Date('2026-03-15T02:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
    ]);

    const rows = await readDays();
    expect(rows).toEqual([
      expect.objectContaining({ commitCount: 1, issueCount: 1 }),
    ]);
  });

  it('미가입자 기여도 원장에 남는다 — 가입 여부는 읽기 조건이 가른다(U3)', async () => {
    await repository.recordContributions(GITHUB_REPO_ID, 'commit', [
      {
        githubKey: 'by-member',
        occurredAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
      {
        githubKey: 'by-stranger',
        occurredAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: STRANGER.toString(),
      },
    ]);

    const rows = await readDays();

    expect(rows.map((row) => row.githubId)).toEqual([MEMBER, STRANGER]);
  });

  it('재실행해도 같은 값이다 — 누적이 아니라 덮어쓰기다', async () => {
    const batch = [
      {
        githubKey: 'idempotent-a',
        occurredAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
      {
        githubKey: 'idempotent-b',
        occurredAt: new Date('2026-03-15T02:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
    ];
    await repository.recordContributions(GITHUB_REPO_ID, 'commit', batch);
    const first = await readDays();

    await repository.recordContributions(GITHUB_REPO_ID, 'commit', batch);
    const second = await readDays();

    expect(second).toEqual(first);
    expect(second[0]?.commitCount).toBe(2);
  });

  it('같은 날의 다른 커밋은 이전 이벤트를 지우지 않는다', async () => {
    await repository.recordContributions(GITHUB_REPO_ID, 'commit', [
      {
        githubKey: 'stays',
        occurredAt: new Date('2026-03-15T01:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
    ]);
    await repository.recordContributions(GITHUB_REPO_ID, 'commit', [
      {
        githubKey: 'also-stays',
        occurredAt: new Date('2026-03-15T03:00:00.000Z'),
        authorGithubId: MEMBER.toString(),
      },
    ]);

    const rows = await readDays();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.commitCount).toBe(2);
  });

  it('칸이 늘어도 질의 수가 늘지 않는다 — 트랜잭션 안 N+1 을 만들지 않는다', async () => {
    const facts = Array.from({ length: 60 }, (_, index) => ({
      githubKey: `bulk-${index}`,
      occurredAt: new Date(Date.UTC(2026, 4, 1 + index, 3, 0, 0)),
      authorGithubId: MEMBER.toString(),
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
      new PlatformRepository(),
    );

    await loggedRepository.recordContributions(GITHUB_REPO_ID, 'commit', facts);
    await logged.$disconnect();

    expect(
      await prisma.contributionEvent.count({
        where: { repoId: GITHUB_REPO_ID },
      }),
    ).toBe(60);

    const dataQueries = queries.filter(
      (query) => !/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/u.test(query.trim()),
    );
    expect(dataQueries.length).toBeLessThan(15);
  });
});

describe('수집 성공 기록 (실 Postgres)', () => {
  const prisma = new PrismaClient();
  const repository = new CollectionIncrementalRepository(
    prisma as unknown as PrismaService,
    new PlatformRepository(),
  );
  const GITHUB_IDS = [9_930_000_001n, 9_930_000_002n, 9_930_000_003n];

  beforeAll(() => prisma.$connect());
  afterAll(async () => {
    await prisma.repo.deleteMany({
      where: { githubRepoId: { in: GITHUB_IDS } },
    });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.repo.deleteMany({
      where: { githubRepoId: { in: GITHUB_IDS } },
    });
    await prisma.repo.createMany({
      data: GITHUB_IDS.map((githubRepoId) => ({
        githubRepoId,
        ownerName: `queue-success/${githubRepoId}`,
        source: 'ORG_PROVISIONED' as const,
      })),
    });
  });

  it('성공한 저장소들의 repo.last_success_at만 한 번에 올리고 나머지는 그대로 둔다', async () => {
    const at = new Date('2026-05-01T00:00:00.000Z');

    await repository.recordRepositorySuccess(GITHUB_IDS.slice(0, 2), at);

    await expect(
      prisma.repo.findMany({
        where: { githubRepoId: { in: GITHUB_IDS } },
        orderBy: { githubRepoId: 'asc' },
        select: { githubRepoId: true, lastSuccessAt: true },
      }),
    ).resolves.toEqual([
      { githubRepoId: GITHUB_IDS[0], lastSuccessAt: at },
      { githubRepoId: GITHUB_IDS[1], lastSuccessAt: at },
      { githubRepoId: GITHUB_IDS[2], lastSuccessAt: null },
    ]);
  });
});
