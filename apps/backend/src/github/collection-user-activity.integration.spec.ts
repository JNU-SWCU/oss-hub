import { AccountStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';

import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
  type CollectionUserActivityMetrics,
} from './collection-discovery.client';
import { CollectionCutoverRepository } from './repository/collection-cutover.repository';
import { CollectionSchedulerService } from './service/collection-scheduler.service';
import { CollectionSyncService } from './service/collection-sync.service';
import { CollectionUserActivityService } from './service/collection-user-activity.service';

/**
 * 사람 축 수집 sweep을 **실 Postgres** 로 검증한다. GraphQL 계층만 대체하고
 * (실제 GitHub을 두드리지 않는다) DB는 진짜를 쓴다 — "로그가 성공이라고 말했다"가
 * 아니라 **행을 되읽어서** 적재를 증명하기 위해서다.
 */
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

  const buildService = (): CollectionUserActivityService =>
    new CollectionUserActivityService(
      prisma,
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
  });

  const seededRows = () =>
    prisma.githubUserActivityHistory.findMany({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
      orderBy: [{ githubId: 'asc' }, { year: 'asc' }],
    });

  // (a) 학생 3명 관측 후 3행 — 로그가 아니라 되읽은 행으로 증명한다.
  it('ACTIVE 학생 3명을 관측하면 (githubId, year) 3행이 실제로 적재된다', async () => {
    const result = await buildService().run();

    expect(result).toEqual({
      observedUserCount: 3,
      upsertedRowCount: 3,
      skippedPastYearCount: 0,
      failedUserCount: 0,
    });

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
    // DEACTIVATED 계정은 애초에 순회 대상이 아니다.
    expect(
      rows.some((row) => row.githubId === DEACTIVATED_GITHUB_ID),
    ).toBe(false);
  });

  // (b) 재실행 멱등 — 행이 늘지 않고 값만 갱신된다(stale_state 방어).
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

  // (c) 1명 실패 시 나머지 2명 적재 — 실패 격리.
  it('한 학생이 실패해도 나머지 2명은 그대로 적재된다', async () => {
    fetchUserActivityMetrics.mockImplementation((login) =>
      login === `${SEED_PREFIX}-bravo`
        ? Promise.reject(new CollectionDiscoveryClientError('RATE_LIMITED', 30))
        : Promise.resolve(metricsFor(login)),
    );

    const result = await buildService().run();

    expect(result).toEqual({
      observedUserCount: 3,
      upsertedRowCount: 2,
      skippedPastYearCount: 0,
      failedUserCount: 1,
    });
    const rows = await seededRows();
    expect(rows.map((row) => row.githubId)).toEqual([
      ALPHA_GITHUB_ID,
      CHARLIE_GITHUB_ID,
    ]);
  });

  // malformed_input — 필드가 빠진 응답은 client가 오류로 바꾸고, 그 학생만 실패한다.
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

  // (d) 비가입 login 미조회.
  it('가입하지 않은 login은 한 번도 조회하지 않는다', async () => {
    await buildService().run();

    const queried = fetchUserActivityMetrics.mock.calls.map(([login]) => login);
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

  // (e) 과거 연도 행 재호출 안 함.
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

    const result = await buildService().run([PAST_YEAR]);

    expect(result.skippedPastYearCount).toBe(1);
    expect(
      fetchUserActivityMetrics.mock.calls.map(([login]) => login),
    ).not.toContain(`${SEED_PREFIX}-alpha`);
    const alpha = await prisma.githubUserActivityHistory.findUnique({
      where: {
        githubId_year: { githubId: ALPHA_GITHUB_ID, year: PAST_YEAR },
      },
    });
    expect(alpha).toEqual(
      expect.objectContaining({ commitCount: 1234, observedAt: pastObservedAt }),
    );
    // 행이 없는 나머지 두 명은 과거 연도라도 새로 관측된다.
    const rows = await seededRows();
    expect(rows).toHaveLength(3);
  });

  // (f) cron tick 1회에 org·external·person 세 sweep 관측.
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
    // person sweep은 fire-and-forget으로 시작된다 — 시간을 기다리는 대신
    // 그 sweep이 돌려주는 promise 자체를 잡아 결정적으로 기다린다.
    const service = buildService();
    let personSweep: Promise<unknown> | undefined;
    const testingModule: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionSchedulerService,
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
    const scheduler = testingModule.get(CollectionSchedulerService);

    await scheduler.handleCron();
    expect(personSweep).toBeDefined();
    await personSweep;

    expect(run).toHaveBeenCalledTimes(1);
    expect(runExternal).toHaveBeenCalledTimes(1);
    // person sweep은 로그가 아니라 실제 적재된 행으로 증명한다.
    await expect(
      prisma.githubUserActivityHistory.count({
        where: { githubId: { in: SEEDED_GITHUB_IDS } },
      }),
    ).resolves.toBe(3);
    await testingModule.close();
  });
});
