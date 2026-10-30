import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { AuthConfig } from '../../auth/auth.config';
import { SessionGuard } from '../../auth/controller/session.guard';
import { sessionCookieName } from '../../auth/domain/cookies';
import { issueSessionToken } from '../../auth/domain/session-token';
import { AuthService } from '../../auth/service/auth.service';
import { configureHttpApp } from '../../common/controller/configure-http-app';
import { PrismaService } from '../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { UsersAuthorityRepository } from '../../users/repository/authority.repository';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { CollectionAdminController } from '../controller/collection-admin.controller';
import {
  CollectionDiscoveryClient,
  type CollectionDiscoveryTokenProvider,
} from '../gateway/collection-discovery.client';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import { CollectionUserActivityRepository } from '../repository/collection-user-activity.repository';
import { ContributionInvariants } from '../repository/contribution-invariants';
import { CollectionAdminService } from './collection-admin.service';
import { CollectionSnapshotBackfillService } from './collection-snapshot-backfill.service';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SEED_PREFIX = 'synthetic-snapshot-backfill';
const U1_GITHUB_ID = 9_970_000_001n;
const U2_GITHUB_ID = 9_970_000_002n;
const U3_GITHUB_ID = 9_970_000_003n;
const SEEDED_GITHUB_IDS = [U1_GITHUB_ID, U2_GITHUB_ID, U3_GITHUB_ID];
const ADMIN_GITHUB_ID = 9_970_000_009n;
const CLEANED_GITHUB_IDS = [...SEEDED_GITHUB_IDS, ADMIN_GITHUB_ID];
const LOGIN = new Map<bigint, string>([
  [U1_GITHUB_ID, `${SEED_PREFIX}-u1`],
  [U2_GITHUB_ID, `${SEED_PREFIX}-u2`],
  [U3_GITHUB_ID, `${SEED_PREFIX}-u3`],
]);
const SWEEP_STAR_COUNT = new Map<bigint, number>([
  [U1_GITHUB_ID, 51],
  [U2_GITHUB_ID, 52],
  [U3_GITHUB_ID, 53],
]);

const YEAR = 2026;
const NOW = new Date('2026-10-31T03:00:00.000Z');
const SWEEP_SNAPSHOT_DATE = new Date(Date.UTC(2026, 9, 31));
const U1_JANUARY_SWEEP_DATE = new Date(Date.UTC(2026, 0, 31));
const U1_JANUARY_SWEEP_STAR_COUNT = 11;
const U1_JANUARY_SWEEP_COMMIT_COUNT = 100;
const BACKFILLED_MONTH_COUNT = 9;

type Fetcher = jest.Mock<
  Promise<Response>,
  [input: string | URL, init?: RequestInit]
>;

const monthEnd = (month: number): Date => new Date(Date.UTC(YEAR, month, 0));

const monthEndsFrom = (first: number): Date[] =>
  Array.from({ length: BACKFILLED_MONTH_COUNT - first + 1 }, (_unused, index) =>
    monthEnd(first + index),
  );

const sentVariables = (
  init: RequestInit | undefined,
): { login: string } & Record<string, string> =>
  (
    JSON.parse(init?.body as string) as {
      variables: { login: string } & Record<string, string>;
    }
  ).variables;

const cannedMonthlyFetcher = (): Fetcher =>
  jest.fn<Promise<Response>, [string | URL, RequestInit?]>((_input, init) => {
    const variables = sentVariables(init);
    const months: Record<string, unknown> = {};
    for (const key of Object.keys(variables)) {
      if (!key.endsWith('From')) continue;
      const alias = key.slice(0, -'From'.length);
      if (!/^m\d{2}$/.test(alias)) continue;
      const month = Number(alias.slice(1));
      months[alias] = {
        totalCommitContributions: month,
        totalPullRequestContributions: month * 2,
        totalIssueContributions: 3,
        totalRepositoryContributions: 4,
      };
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            rateLimit: { cost: 2, remaining: 4_000 },
            user: months,
          },
        }),
        { status: 200 },
      ),
    );
  });

const fakeTokens: CollectionDiscoveryTokenProvider = {
  getToken: () => Promise.resolve('synthetic-backfill-token'),
  clear: () => undefined,
};

describe('월별 스냅샷 백필 (실 Postgres)', () => {
  const prisma = new PrismaService();
  let fetcher: Fetcher;

  const buildService = (): CollectionSnapshotBackfillService =>
    new CollectionSnapshotBackfillService(
      new CollectionUserActivityRepository(prisma),
      new CollectionDiscoveryClient(
        { apiUrl: 'https://api.github.test/graphql', deadlineMs: 5_000 },
        fakeTokens,
        fetcher,
      ),
      () => NOW,
    );

  const requestedLogins = (): string[] =>
    fetcher.mock.calls
      .map(([, init]) => sentVariables(init).login)
      .filter((login) => login.startsWith(`${SEED_PREFIX}-`));

  const countBackfillRows = (): Promise<number> =>
    prisma.githubUserActivitySnapshot.count({ where: { source: 'BACKFILL' } });

  const rowsOf = (githubId: bigint) =>
    prisma.githubUserActivitySnapshot.findMany({
      where: { githubId },
      orderBy: { snapshotDate: 'asc' },
    });

  const cleanup = async (): Promise<void> => {
    await prisma.githubUserActivitySnapshot.deleteMany({
      where: { githubId: { in: CLEANED_GITHUB_IDS } },
    });
    await prisma.githubUserActivityHistory.deleteMany({
      where: { githubId: { in: CLEANED_GITHUB_IDS } },
    });
    await prisma.user.deleteMany({
      where: { githubId: { in: CLEANED_GITHUB_IDS } },
    });
  };

  const seed = async (): Promise<void> => {
    for (const githubId of SEEDED_GITHUB_IDS) {
      const nickname = LOGIN.get(githubId);
      const starCount = SWEEP_STAR_COUNT.get(githubId);
      if (nickname === undefined || starCount === undefined) {
        throw new Error('unreachable — seeded maps');
      }
      await prisma.user.create({
        data: {
          id: `${SEED_PREFIX}-${githubId.toString()}`,
          githubId,
          nickname,
          accountStatus: AccountStatus.ACTIVE,
        },
      });
      await prisma.githubUserActivitySnapshot.create({
        data: {
          githubId,
          snapshotDate: SWEEP_SNAPSHOT_DATE,
          year: YEAR,
          githubLogin: nickname,
          commitCount: 300,
          pullRequestCount: 30,
          issueCount: 3,
          repositoryCount: 4,
          starCount,
          starEstimated: false,
          source: 'SWEEP',
          observedAt: NOW,
        },
      });
      await prisma.githubUserActivityHistory.create({
        data: {
          githubId,
          year: YEAR,
          githubLogin: nickname,
          commitCount: 300,
          pullRequestCount: 30,
          issueCount: 3,
          repositoryCount: 4,
          starCount: 999,
          observedAt: NOW,
        },
      });
    }
    const u1Login = LOGIN.get(U1_GITHUB_ID);
    if (u1Login === undefined) throw new Error('unreachable — seeded maps');
    await prisma.githubUserActivitySnapshot.create({
      data: {
        githubId: U1_GITHUB_ID,
        snapshotDate: U1_JANUARY_SWEEP_DATE,
        year: YEAR,
        githubLogin: u1Login,
        commitCount: U1_JANUARY_SWEEP_COMMIT_COUNT,
        pullRequestCount: 7,
        issueCount: 3,
        repositoryCount: 4,
        starCount: U1_JANUARY_SWEEP_STAR_COUNT,
        starEstimated: false,
        source: 'SWEEP',
        observedAt: new Date('2026-01-31T03:00:00.000Z'),
      },
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
    await seed();
    fetcher = cannedMonthlyFetcher();
  });

  it('학생당 한 번의 aliased 요청으로 지난달까지의 월말 행을 채우고 기존 SWEEP 행은 그대로 둔다', async () => {
    const backfillRowsBefore = await countBackfillRows();

    const result = await buildService().run(YEAR);

    const backfillRowsAfter = await countBackfillRows();
    expect(result.writtenRowCount).toBe(backfillRowsAfter - backfillRowsBefore);
    expect(result.failedUserCount).toBe(0);
    expect(result.stoppedForBudget).toBe(false);
    expect(requestedLogins()).toEqual([
      `${SEED_PREFIX}-u1`,
      `${SEED_PREFIX}-u2`,
      `${SEED_PREFIX}-u3`,
    ]);

    const u1Rows = await rowsOf(U1_GITHUB_ID);
    const u1Backfilled = u1Rows.filter((row) => row.source === 'BACKFILL');
    expect(u1Backfilled.map((row) => row.snapshotDate)).toEqual(
      monthEndsFrom(2),
    );
    expect(
      u1Backfilled.every(
        (row) =>
          row.starEstimated &&
          row.starCount === SWEEP_STAR_COUNT.get(U1_GITHUB_ID) &&
          row.year === YEAR &&
          row.githubLogin === `${SEED_PREFIX}-u1` &&
          row.observedAt.getTime() === NOW.getTime(),
      ),
    ).toBe(true);
    expect(
      u1Rows.find(
        (row) => row.snapshotDate.getTime() === U1_JANUARY_SWEEP_DATE.getTime(),
      ),
    ).toEqual(
      expect.objectContaining({
        source: 'SWEEP',
        starEstimated: false,
        starCount: U1_JANUARY_SWEEP_STAR_COUNT,
        commitCount: U1_JANUARY_SWEEP_COMMIT_COUNT,
      }),
    );

    const u2Backfilled = (await rowsOf(U2_GITHUB_ID)).filter(
      (row) => row.source === 'BACKFILL',
    );
    expect(u2Backfilled).toHaveLength(BACKFILLED_MONTH_COUNT);
    expect(u2Backfilled.map((row) => row.snapshotDate)).toEqual(
      monthEndsFrom(1),
    );
    expect(
      u2Backfilled.map((row) => [row.commitCount, row.pullRequestCount]),
    ).toEqual([
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10],
      [6, 12],
      [7, 14],
      [8, 16],
      [9, 18],
    ]);
    expect(
      u2Backfilled.every(
        (row) => row.starCount === SWEEP_STAR_COUNT.get(U2_GITHUB_ID),
      ),
    ).toBe(true);
    expect(
      (await rowsOf(U3_GITHUB_ID)).filter((row) => row.source === 'BACKFILL'),
    ).toHaveLength(BACKFILLED_MONTH_COUNT);
  });

  it('재실행은 요청도 쓰기도 없이 멱등하다', async () => {
    const service = buildService();
    await service.run(YEAR);
    const rowsAfterFirstRun = await prisma.githubUserActivitySnapshot.count({
      where: { githubId: { in: SEEDED_GITHUB_IDS } },
    });
    fetcher.mockClear();

    const second = await service.run(YEAR);

    expect(second.requestCount).toBe(0);
    expect(second.writtenRowCount).toBe(0);
    expect(second.skippedExistingCount).toBeGreaterThanOrEqual(
      BACKFILLED_MONTH_COUNT * SEEDED_GITHUB_IDS.length,
    );
    expect(requestedLogins()).toEqual([]);
    await expect(
      prisma.githubUserActivitySnapshot.count({
        where: { githubId: { in: SEEDED_GITHUB_IDS } },
      }),
    ).resolves.toBe(rowsAfterFirstRun);
  });

  it('그 해 SWEEP 스냅샷이 전혀 없으면 409로 멈추고 BACKFILL 행을 만들지 않는다', async () => {
    await prisma.githubUserActivitySnapshot.deleteMany({
      where: { source: 'SWEEP', year: YEAR },
    });
    const backfillRowsBefore = await countBackfillRows();

    await expect(buildService().run(YEAR)).rejects.toMatchObject({
      status: 409,
    });

    expect(fetcher).not.toHaveBeenCalled();
    await expect(countBackfillRows()).resolves.toBe(backfillRowsBefore);
  });

  describe('관리자 HTTP 표면', () => {
    let app: INestApplication;
    let baseUrl: string;
    let cookie: string;
    let adminCookie: string;
    let auditWrites: unknown[];

    beforeEach(async () => {
      auditWrites = [];
      await prisma.user.create({
        data: {
          id: `${SEED_PREFIX}-${ADMIN_GITHUB_ID.toString()}`,
          githubId: ADMIN_GITHUB_ID,
          nickname: `${SEED_PREFIX}-admin`,
          accountStatus: AccountStatus.ACTIVE,
          hasStaffAccess: true,
          hasAdminAccess: true,
        },
      });
      const module = await Test.createTestingModule({
        controllers: [CollectionAdminController],
        providers: [
          SessionGuard,
          CollectionAdminService,
          UsersAuthorityService,
          UsersAuthorityRepository,
          CollectionUserActivityRepository,
          { provide: PrismaService, useValue: prisma },
          {
            provide: AuthService,
            useValue: {
              getMe: () =>
                Promise.resolve({
                  id: `${SEED_PREFIX}-${U1_GITHUB_ID.toString()}`,
                  sessionVersion: 0,
                }),
            },
          },
          {
            provide: AuthConfig,
            useValue: new AuthConfig(
              loadRuntimeConfig({
                SESSION_SECRET: Buffer.from(
                  'synthetic-snapshot-backfill-secret',
                ).toString('base64url'),
                FRONTEND_URL: 'http://localhost:3000',
                GITHUB_OAUTH_CLIENT_ID: 'synthetic-client',
                GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-secret',
              }),
            ),
          },
          {
            provide: CollectionSnapshotBackfillService,
            useFactory: () => buildService(),
          },
          {
            provide: CollectionSyncService,
            useValue: {
              run: () => Promise.reject(new Error('not expected')),
              runExternal: () => Promise.reject(new Error('not expected')),
            },
          },
          {
            provide: CollectionUserActivityService,
            useValue: { run: () => Promise.reject(new Error('not expected')) },
          },
          {
            provide: ContributionInvariants,
            useValue: {
              check: () => Promise.reject(new Error('not expected')),
            },
          },
          {
            provide: CollectionCutoverRepository,
            useValue: { isQuiesced: () => Promise.resolve(false) },
          },
          {
            provide: CollectionIncrementalRepository,
            useValue: {
              listSyncRuns: () => Promise.reject(new Error('not expected')),
            },
          },
          {
            provide: AuditLogService,
            useValue: {
              record: (input: unknown) => {
                auditWrites.push(input);
                return Promise.resolve({});
              },
            },
          },
        ],
      }).compile();
      const config = module.get(AuthConfig);
      cookie = `${sessionCookieName(config.useSecureCookies)}=${await issueSessionToken(
        config.sessionSecret,
        U1_GITHUB_ID,
        0,
      )}`;
      adminCookie = `${sessionCookieName(config.useSecureCookies)}=${await issueSessionToken(
        config.sessionSecret,
        ADMIN_GITHUB_ID,
        0,
      )}`;
      app = module.createNestApplication();
      configureHttpApp(app);
      await app.listen(0, '127.0.0.1');
      baseUrl = await app.getUrl();
    });

    afterEach(async () => {
      await app.close();
    });

    const postBackfill = (headers: Record<string, string>): Promise<Response> =>
      fetch(`${baseUrl}/api/v1/admin/collection/snapshot-backfill`, {
        method: 'POST',
        headers: {
          connection: 'close',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ year: YEAR }),
      });

    it('세션 없는 요청은 401이고 BACKFILL 행을 한 줄도 만들지 않는다', async () => {
      const backfillRowsBefore = await countBackfillRows();

      const response = await postBackfill({});
      const body: unknown = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual(
        expect.objectContaining({ status: 401, code: 'AUT_003' }),
      );
      expect(fetcher).not.toHaveBeenCalled();
      await expect(countBackfillRows()).resolves.toBe(backfillRowsBefore);
    });

    it('관리자가 아닌 세션은 403이고 BACKFILL 행을 한 줄도 만들지 않는다', async () => {
      const backfillRowsBefore = await countBackfillRows();

      const response = await postBackfill({ cookie });
      const body: unknown = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual(
        expect.objectContaining({ status: 403, code: 'COL_004' }),
      );
      expect(fetcher).not.toHaveBeenCalled();
      expect(auditWrites).toEqual([]);
      await expect(countBackfillRows()).resolves.toBe(backfillRowsBefore);
    });

    it('그 해 SWEEP 스냅샷이 없으면 관리자에게도 409를 돌리고 감사도 BACKFILL 행도 남기지 않는다', async () => {
      await prisma.githubUserActivitySnapshot.deleteMany({
        where: { source: 'SWEEP', year: YEAR },
      });
      const backfillRowsBefore = await countBackfillRows();

      const response = await postBackfill({ cookie: adminCookie });
      const body: unknown = await response.json();

      expect(response.status).toBe(409);
      expect(body).toEqual(
        expect.objectContaining({ status: 409, title: 'CONFLICT' }),
      );
      expect(auditWrites).toEqual([]);
      expect(fetcher).not.toHaveBeenCalled();
      await expect(countBackfillRows()).resolves.toBe(backfillRowsBefore);
    });
  });
});
