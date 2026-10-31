import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccountStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import {
  countForeignActiveUsers,
  restoreForeignActivityRows,
  snapshotForeignActivityRows,
} from './collection-user-activity.integration-support';
import {
  CollectionDiscoveryClient,
  type CollectionUserActivityMetrics,
} from './collection-discovery.client';
import {
  CollectionCutoverRepository,
  CollectionUserActivityRepository,
} from './repository-provision-job.repository';
import { CollectionTriggerService } from './collection-trigger.service';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';
import { CollectionDiscoveryClientError } from './collection-discovery.error';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SEED_PREFIX = 'synthetic-person-axis';
const ALPHA_GITHUB_ID = 9_940_000_001n;
const BRAVO_GITHUB_ID = 9_940_000_002n;
const CHARLIE_GITHUB_ID = 9_940_000_003n;
const DEACTIVATED_GITHUB_ID = 9_940_000_004n;
const OUTSIDER_GITHUB_ID = 9_940_000_005n;
const SEEDED_GITHUB_IDS = [
  ALPHA_GITHUB_ID,
  BRAVO_GITHUB_ID,
  CHARLIE_GITHUB_ID,
  DEACTIVATED_GITHUB_ID,
  OUTSIDER_GITHUB_ID,
];
const LOGIN = new Map<bigint, string>([
  [ALPHA_GITHUB_ID, `${SEED_PREFIX}-alpha`],
  [BRAVO_GITHUB_ID, `${SEED_PREFIX}-bravo`],
  [CHARLIE_GITHUB_ID, `${SEED_PREFIX}-charlie`],
  [DEACTIVATED_GITHUB_ID, `${SEED_PREFIX}-deactivated`],
  [OUTSIDER_GITHUB_ID, `${SEED_PREFIX}-outsider`],
]);

const NOW = new Date('2026-08-19T00:00:00.000Z');
const CURRENT_YEAR = 2026;
const PAST_YEAR = 2025;

const metricsFor = (login: string): CollectionUserActivityMetrics => ({
  commitCount: login.length,
  pullRequestCount: 2,
  issueCount: 3,
  repositoryCount: 4,
  starCount: 5,
});

describe('사람 축 활동 수집 sweep (실 Postgres)', () => {
  const prisma = new PrismaService();
  const fetchUserActivityMetrics = jest.fn<
    Promise<CollectionUserActivityMetrics>,
    [string, string, string]
  >();

  let foreignActiveUserCount = 0;

  let foreignActivitySnapshot: Awaited<
    ReturnType<typeof snapshotForeignActivityRows>
  > = [];

  const buildService = (): CollectionUserActivityService =>
    new CollectionUserActivityService(
      new CollectionUserActivityRepository(prisma),
      { fetchUserActivityMetrics } as unknown as CollectionDiscoveryClient,
      () => NOW,
    );

  const seedUser = async (
    githubId: bigint,
    accountStatus: AccountStatus,
  ): Promise<void> => {
    const nickname = LOGIN.get(githubId);
    if (nickname === undefined) throw new Error('unreachable — seeded map');
    await prisma.user.create({
      data: {
        id: `${SEED_PREFIX}-${githubId.toString()}`,
        githubId,
        nickname,
        accountStatus,
      },
    });
  };

  const cleanup = async (): Promise<void> => {
    await prisma.githubUserActivityHistory.deleteMany({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
    });
    await prisma.user.deleteMany({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
    });
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    fetchUserActivityMetrics.mockReset();
    fetchUserActivityMetrics.mockImplementation((login) =>
      Promise.resolve(metricsFor(login)),
    );
    await seedUser(ALPHA_GITHUB_ID, AccountStatus.ACTIVE);
    await seedUser(BRAVO_GITHUB_ID, AccountStatus.ACTIVE);
    await seedUser(CHARLIE_GITHUB_ID, AccountStatus.ACTIVE);
    await seedUser(DEACTIVATED_GITHUB_ID, AccountStatus.DEACTIVATED);
    foreignActiveUserCount = await countForeignActiveUsers(
      prisma,
      SEEDED_GITHUB_IDS,
    );
    foreignActivitySnapshot = await snapshotForeignActivityRows(
      prisma,
      SEEDED_GITHUB_IDS,
    );
  });

  afterEach(async () => {
    await restoreForeignActivityRows(
      prisma,
      SEEDED_GITHUB_IDS,
      foreignActivitySnapshot,
    );
  });

  const seededRows = () =>
    prisma.githubUserActivityHistory.findMany({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
      orderBy: [{ githubId: 'asc' }, { year: 'asc' }],
    });

  const seededQueriedLogins = (): string[] =>
    fetchUserActivityMetrics.mock.calls
      .map(([login]) => login)
      .filter((login) => login.startsWith(`${SEED_PREFIX}-`));

  it('ACTIVE 학생 3명을 관측하면 (githubId, year) 3행이 실제로 적재된다', async () => {
    const result = await buildService().run();

    expect(result).toEqual({
      observedUserCount: foreignActiveUserCount + 3,
      upsertedRowCount: foreignActiveUserCount + 3,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });
    expect(seededQueriedLogins().sort()).toEqual([
      `${SEED_PREFIX}-alpha`,
      `${SEED_PREFIX}-bravo`,
      `${SEED_PREFIX}-charlie`,
    ]);

    const rows = await seededRows();
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => [row.githubId, row.year, row.githubLogin]),
    ).toEqual([
      [ALPHA_GITHUB_ID, CURRENT_YEAR, `${SEED_PREFIX}-alpha`],
      [BRAVO_GITHUB_ID, CURRENT_YEAR, `${SEED_PREFIX}-bravo`],
      [CHARLIE_GITHUB_ID, CURRENT_YEAR, `${SEED_PREFIX}-charlie`],
    ]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        commitCount: `${SEED_PREFIX}-alpha`.length,
        pullRequestCount: 2,
        issueCount: 3,
        repositoryCount: 4,
        starCount: 5,
        observedAt: NOW,
      }),
    );

    expect(rows.some((row) => row.githubId === DEACTIVATED_GITHUB_ID)).toBe(
      false,
    );
  });

  it('마이그레이션은 기존 활동 행과 수치를 PUBLIC으로 보존한다 (stale_state)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE SCHEMA activity_visibility_migration');
      await tx.$executeRawUnsafe(
        'SET LOCAL search_path TO activity_visibility_migration',
      );
      const migrations = resolve(__dirname, '../../prisma/migrations');
      const previousSql = readFileSync(
        resolve(
          migrations,
          '20260819090000_add_github_user_activity_history/migration.sql',
        ),
        'utf8',
      );
      for (const statement of previousSql
        .split(';')
        .filter((sql) => sql.trim())) {
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRaw`
        INSERT INTO "GithubUserActivityHistory"
          ("githubId", "githubLogin", "year", "commitCount", "pullRequestCount",
           "issueCount", "repositoryCount", "starCount", "observedAt")
        VALUES (${ALPHA_GITHUB_ID}, 'legacy-login', 2026, 42, 8, 7, 6, 5, ${NOW})
      `;

      const migrationSql = readFileSync(
        resolve(
          migrations,
          '20261031000000_add_activity_visibility/migration.sql',
        ),
        'utf8',
      );
      for (const statement of migrationSql
        .split(';')
        .filter((sql) => sql.trim())) {
        await tx.$executeRawUnsafe(statement);
      }

      const rows = await tx.$queryRaw`
        SELECT * FROM "GithubUserActivityHistory"
      `;
      expect(rows).toEqual([
        {
          githubId: ALPHA_GITHUB_ID,
          githubLogin: 'legacy-login',
          year: CURRENT_YEAR,
          visibility: 'PUBLIC',
          commitCount: 42,
          pullRequestCount: 8,
          issueCount: 7,
          repositoryCount: 6,
          starCount: 5,
          observedAt: NOW,
        },
      ]);
      await tx.$executeRawUnsafe(
        'DROP SCHEMA activity_visibility_migration CASCADE',
      );
    });
  });

  it('같은 githubId와 연도에 PUBLIC과 PRIVATE 관측을 함께 보존한다', async () => {
    await buildService().run();
    const repository = new CollectionUserActivityRepository(prisma);
    const privateObservation = {
      githubId: ALPHA_GITHUB_ID,
      githubLogin: `${SEED_PREFIX}-alpha`,
      year: CURRENT_YEAR,
      commitCount: 42,
      pullRequestCount: 8,
      issueCount: 7,
      repositoryCount: 6,
      observedAt: NOW,
    };

    await repository.upsertPrivateObservation(privateObservation);

    const rows = await prisma.githubUserActivityHistory.findMany({
      where: { githubId: ALPHA_GITHUB_ID, year: CURRENT_YEAR },
    });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          visibility: 'PUBLIC',
          ...metricsFor(`${SEED_PREFIX}-alpha`),
        }),
        expect.objectContaining({
          ...privateObservation,
          visibility: 'PRIVATE',
          starCount: 0,
        }),
      ]),
    );
  });

  it('PUBLIC 재수집은 PRIVATE 행의 수치와 관측 시각을 바꾸지 않는다', async () => {
    const repository = new CollectionUserActivityRepository(prisma);
    await repository.upsertPrivateObservation({
      githubId: ALPHA_GITHUB_ID,
      githubLogin: `${SEED_PREFIX}-alpha`,
      year: CURRENT_YEAR,
      commitCount: 42,
      pullRequestCount: 8,
      issueCount: 7,
      repositoryCount: 6,
      observedAt: new Date('2026-08-18T00:00:00.000Z'),
    });
    const privateBefore =
      await prisma.githubUserActivityHistory.findFirstOrThrow({
        where: { githubId: ALPHA_GITHUB_ID },
      });

    await buildService().run();

    const rows = await prisma.githubUserActivityHistory.findMany({
      where: { githubId: ALPHA_GITHUB_ID, year: CURRENT_YEAR },
    });
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(privateBefore);
    expect(rows).toContainEqual(
      expect.objectContaining({
        visibility: 'PUBLIC',
        ...metricsFor(`${SEED_PREFIX}-alpha`),
        observedAt: NOW,
      }),
    );
  });

  it('PRIVATE 재관측은 같은 행을 갱신하고 별은 0으로 유지한다', async () => {
    const repository = new CollectionUserActivityRepository(prisma);
    const observation = {
      githubId: ALPHA_GITHUB_ID,
      githubLogin: `${SEED_PREFIX}-alpha`,
      year: CURRENT_YEAR,
      commitCount: 42,
      pullRequestCount: 8,
      issueCount: 7,
      repositoryCount: 6,
      observedAt: NOW,
    };
    await repository.upsertPrivateObservation(observation);

    await repository.upsertPrivateObservation({
      ...observation,
      commitCount: 43,
      observedAt: new Date('2026-08-19T01:00:00.000Z'),
    });

    const rows = await prisma.githubUserActivityHistory.findMany({
      where: { githubId: ALPHA_GITHUB_ID },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        visibility: 'PRIVATE',
        commitCount: 43,
        starCount: 0,
        observedAt: new Date('2026-08-19T01:00:00.000Z'),
      }),
    );
  });

  it('재실행해도 행이 늘지 않고 전량 재계산으로 덮어쓴다', async () => {
    const service = buildService();
    await service.run();

    fetchUserActivityMetrics.mockImplementation(() =>
      Promise.resolve({
        commitCount: 99,
        pullRequestCount: 88,
        issueCount: 77,
        repositoryCount: 66,
        starCount: 55,
      }),
    );
    await service.run();

    const rows = await seededRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toEqual(
        expect.objectContaining({
          year: CURRENT_YEAR,
          commitCount: 99,
          starCount: 55,
        }),
      );
    }
  });

  it('한 학생이 실패해도 나머지 2명은 그대로 적재된다', async () => {
    fetchUserActivityMetrics.mockImplementation((login) =>
      login === `${SEED_PREFIX}-bravo`
        ? Promise.reject(new CollectionDiscoveryClientError('RATE_LIMITED', 30))
        : Promise.resolve(metricsFor(login)),
    );

    const result = await buildService().run();

    expect(result).toEqual({
      observedUserCount: foreignActiveUserCount + 3,
      upsertedRowCount: foreignActiveUserCount + 2,
      skippedPastYearCount: 0,
      failedUserCount: 1,
    });
    const rows = await seededRows();
    expect(rows.map((row) => row.githubId)).toEqual([
      ALPHA_GITHUB_ID,
      CHARLIE_GITHUB_ID,
    ]);
  });

  it('응답 필드가 빠진 학생 하나는 그 학생만 실패시키고 sweep을 세우지 않는다', async () => {
    fetchUserActivityMetrics.mockImplementation((login) =>
      login === `${SEED_PREFIX}-alpha`
        ? Promise.reject(new CollectionDiscoveryClientError('RESPONSE'))
        : Promise.resolve(metricsFor(login)),
    );

    const result = await buildService().run();

    expect(result.failedUserCount).toBe(1);
    const rows = await seededRows();
    expect(rows.map((row) => row.githubId)).toEqual([
      BRAVO_GITHUB_ID,
      CHARLIE_GITHUB_ID,
    ]);
  });

  it('가입하지 않은 login은 한 번도 조회하지 않는다', async () => {
    await buildService().run();

    const queried = seededQueriedLogins();
    expect(queried).not.toContain(`${SEED_PREFIX}-outsider`);
    expect(queried).not.toContain(`${SEED_PREFIX}-deactivated`);
    expect(queried.sort()).toEqual([
      `${SEED_PREFIX}-alpha`,
      `${SEED_PREFIX}-bravo`,
      `${SEED_PREFIX}-charlie`,
    ]);
    await expect(
      prisma.githubUserActivityHistory.count({
        where: { githubId: OUTSIDER_GITHUB_ID },
      }),
    ).resolves.toBe(0);
  });

  it('과거 연도 행이 이미 있으면 다시 조회하지 않고 값을 건드리지 않는다', async () => {
    const pastObservedAt = new Date('2026-01-02T00:00:00.000Z');
    await prisma.githubUserActivityHistory.create({
      data: {
        githubId: ALPHA_GITHUB_ID,
        githubLogin: `${SEED_PREFIX}-alpha`,
        year: PAST_YEAR,
        commitCount: 1234,
        observedAt: pastObservedAt,
      },
    });

    const foreignPastYearGithubIds = new Set(
      foreignActivitySnapshot
        .filter((row) => row.year === PAST_YEAR)
        .map((row) => row.githubId.toString()),
    );
    const foreignSkippedCount = (
      await prisma.user.findMany({
        where: {
          accountStatus: AccountStatus.ACTIVE,
          githubId: { notIn: SEEDED_GITHUB_IDS },
        },
        select: { githubId: true },
      })
    ).filter((user) =>
      foreignPastYearGithubIds.has(user.githubId.toString()),
    ).length;

    const result = await buildService().run([PAST_YEAR]);

    expect(result.skippedPastYearCount).toBe(foreignSkippedCount + 1);
    expect(seededQueriedLogins()).not.toContain(`${SEED_PREFIX}-alpha`);
    const alpha = await prisma.githubUserActivityHistory.findUnique({
      where: {
        githubId_year_visibility: {
          githubId: ALPHA_GITHUB_ID,
          year: PAST_YEAR,
          visibility: 'PUBLIC',
        },
      },
    });
    expect(alpha).toEqual(
      expect.objectContaining({
        commitCount: 1234,
        observedAt: pastObservedAt,
      }),
    );

    const rows = await seededRows();
    expect(rows).toHaveLength(3);
  });

  it('cron tick 1회가 org·external·person 세 sweep을 모두 돌린다', async () => {
    const run = jest.fn().mockResolvedValue({
      runId: 'synthetic-org-run',
      status: 'COMPLETED',
      inventoryComplete: true,
      processedRepositoryCount: 0,
      cycleCompleted: true,
      stoppedForBudget: false,
      insertedFactCount: 0,
    });
    const runExternal = jest.fn().mockResolvedValue({
      runId: 'synthetic-external-run',
      status: 'COMPLETED',
      inventoryComplete: true,
      processedRepositoryCount: 0,
      cycleCompleted: true,
      stoppedForBudget: false,
      insertedFactCount: 0,
    });

    const service = buildService();
    let personSweep: Promise<unknown> | undefined;
    const testingModule: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionTriggerService,
        { provide: CollectionSyncService, useValue: { run, runExternal } },
        {
          provide: CollectionCutoverRepository,
          useValue: { isQuiesced: () => Promise.resolve(false) },
        },
        {
          provide: CollectionUserActivityService,
          useValue: {
            run: () => {
              personSweep = service.run();
              return personSweep;
            },
          },
        },
      ],
    }).compile();
    const scheduler = testingModule.get(CollectionTriggerService);

    await scheduler.handleCron();
    expect(personSweep).toBeDefined();
    await personSweep;

    expect(run).toHaveBeenCalledTimes(1);
    expect(runExternal).toHaveBeenCalledTimes(1);

    await expect(
      prisma.githubUserActivityHistory.count({
        where: { githubId: { in: SEEDED_GITHUB_IDS } },
      }),
    ).resolves.toBe(3);
    await testingModule.close();
  });
});
