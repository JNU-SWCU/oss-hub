import { AccountStatus } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  countForeignActiveUsers,
  restoreForeignActivityRows,
  snapshotForeignActivityRows,
} from './collection-user-activity.integration-support';
import {
  CollectionDiscoveryClient,
  CollectionDiscoveryClientError,
  type CollectionUserActivityMetrics,
} from './collection-discovery.client';
import { CollectionUserActivityService } from './service/collection-user-activity.service';

/**
 * 프로덕션 실측 규모(2026-08-19 실측: ACTIVE 51명)로 사람 축 sweep을 실 Postgres
 * 위에서 돌린다. GraphQL 계층만 대체하고 DB는 진짜를 쓴다.
 *
 * 작은 스펙(`collection-user-activity.integration.spec.ts`)이 잡지 못하는 성질 셋을
 * 이 규모에서만 고정한다:
 * 1. **한 tick이 전원을 순회한다** — 부분 배치·우선순위 큐가 몰래 들어오면 깨진다.
 * 2. **예산 계약** — 학생 1명 × 연도 1개 = GraphQL cost 1. 이 비율이 무너지면
 *    "매 tick 전원 순회"라는 이번 배치의 전제(5,000/h의 1% 미만)가 무너진다.
 * 3. **50명 규모에서의 실패 격리** — 중간의 한 명이 429를 맞아도 나머지가 전부 남는다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const QA_PREFIX = 'qa-person-axis';
const ACTIVE_USER_COUNT = 51;
const BASE_GITHUB_ID = 9_950_000_000n;
const NOW = new Date('2026-08-19T00:00:00.000Z');
/** NOW의 Asia/Seoul 달력 연도 — sweep이 쓰는 유일한 연도다. */
const CURRENT_YEAR = 2026;

const githubIdAt = (index: number): bigint =>
  BASE_GITHUB_ID + BigInt(index + 1);
const loginAt = (index: number): string =>
  `${QA_PREFIX}-${String(index + 1).padStart(3, '0')}`;

describe('MANUAL QA — 사람 축 sweep 51명 규모 (실 Postgres)', () => {
  const prisma = new PrismaService();
  /** GraphQL 호출 1건 = rate limit cost 1 (`rateLimit{cost}` 실측 계약). */
  let rateLimitCost = 0;
  const queriedLogins: string[] = [];
  let rateLimitedLogin: string | null = null;
  /**
   * 이 스펙이 심지 않았는데 이미 DB에 있는 ACTIVE 유저 수.
   *
   * sweep은 가입자 전원을 도는 게 제품 동작이고(바꾸지 않는다), CI는 79개 통합
   * 스펙이 Postgres 하나를 공유한다. 그래서 "한 tick이 전원을 순회한다"는 이 파일의
   * 핵심 주장은 절대 수 51이 아니라 **기준선 + 시드 51명**으로 고정해야 순서에
   * 의존하지 않고 같은 강도로 남는다 — 시드 한 명이라도 빠지면 즉시 빨간색이다.
   */
  let foreignActiveUserCount = 0;
  let foreignActivitySnapshot: Awaited<
    ReturnType<typeof snapshotForeignActivityRows>
  > = [];
  /** 이 스펙이 심은 login만 남긴다 — 형제 스펙의 유저는 세지 않는다. */
  const seededQueriedLogins = (): string[] =>
    queriedLogins.filter((login) => login.startsWith(`${QA_PREFIX}-`));

  const fetchUserActivityMetrics = (
    login: string,
  ): Promise<CollectionUserActivityMetrics> => {
    rateLimitCost += 1;
    queriedLogins.push(login);
    if (login === rateLimitedLogin) {
      return Promise.reject(
        new CollectionDiscoveryClientError('RATE_LIMITED', 60),
      );
    }
    return Promise.resolve({
      commitCount: 10,
      pullRequestCount: 2,
      issueCount: 3,
      repositoryCount: 4,
      starCount: 5,
    });
  };

  const buildService = (): CollectionUserActivityService =>
    new CollectionUserActivityService(
      prisma,
      { fetchUserActivityMetrics } as unknown as CollectionDiscoveryClient,
      () => NOW,
    );

  const seededIds = Array.from(
    { length: ACTIVE_USER_COUNT },
    (_unused, index) => githubIdAt(index),
  );
  // 비가입(=DB에 없는) login 1건 — 절대 조회되지 않아야 한다.
  const OUTSIDER_LOGIN = `${QA_PREFIX}-outsider`;

  const cleanup = async (): Promise<void> => {
    await prisma.githubUserActivityHistory.deleteMany({
      where: { githubId: { in: seededIds } },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: seededIds } } });
  };

  beforeAll(async () => {
    await prisma.$connect();
    await cleanup();
    await prisma.user.createMany({
      data: seededIds.map((githubId, index) => ({
        id: `${QA_PREFIX}-${githubId.toString()}`,
        githubId,
        nickname: loginAt(index),
        accountStatus: AccountStatus.ACTIVE,
      })),
    });
  });

  beforeEach(async () => {
    foreignActiveUserCount = await countForeignActiveUsers(prisma, seededIds);
    // sweep은 형제 유저에게도 관측 행을 쓴다 — 그 쓰기를 되돌려야 랭킹을
    // 읽는 스펙이 실행 순서에 따라 깨지지 않는다.
    foreignActivitySnapshot = await snapshotForeignActivityRows(
      prisma,
      seededIds,
    );
  });

  afterEach(async () => {
    await restoreForeignActivityRows(
      prisma,
      seededIds,
      foreignActivitySnapshot,
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('51명 전원을 한 tick에 순회하고, 학생당 연도당 cost 1을 쓰며, 행을 되읽어 확인한다', async () => {
    rateLimitCost = 0;
    queriedLogins.length = 0;
    rateLimitedLogin = null;

    const result = await buildService().run();

    const rows = await prisma.githubUserActivityHistory.findMany({
      where: { githubId: { in: seededIds } },
    });

    expect(result.observedUserCount).toBe(
      foreignActiveUserCount + ACTIVE_USER_COUNT,
    );
    expect(rows).toHaveLength(ACTIVE_USER_COUNT);
    expect(rows.every((row) => row.year === CURRENT_YEAR)).toBe(true);
    // 시드 코호트 몫의 예산은 정확히 학생 1명 × 연도 1개 = cost 1이다.
    expect(seededQueriedLogins()).toHaveLength(ACTIVE_USER_COUNT);
    expect(new Set(seededQueriedLogins()).size).toBe(ACTIVE_USER_COUNT);
    expect(rateLimitCost).toBe(foreignActiveUserCount + ACTIVE_USER_COUNT);
    expect(queriedLogins).not.toContain(OUTSIDER_LOGIN);
  });

  it('재실행이 멱등이다 — 행 수가 늘지 않는다(stale_state)', async () => {
    rateLimitCost = 0;
    queriedLogins.length = 0;
    rateLimitedLogin = null;

    await buildService().run();
    const rows = await prisma.githubUserActivityHistory.count({
      where: { githubId: { in: seededIds } },
    });

    expect(rows).toBe(ACTIVE_USER_COUNT);
    // 올해 행은 매 실행 갱신한다 — 재실행이 조회를 건너뛰지 않는다.
    expect(seededQueriedLogins()).toHaveLength(ACTIVE_USER_COUNT);
    expect(rateLimitCost).toBe(foreignActiveUserCount + ACTIVE_USER_COUNT);
  });

  it('한 학생에 429를 주입해도 나머지 50명이 그대로 적재된다', async () => {
    await prisma.githubUserActivityHistory.deleteMany({
      where: { githubId: { in: seededIds } },
    });
    rateLimitCost = 0;
    rateLimitedLogin = loginAt(24);

    const result = await buildService().run();
    const rows = await prisma.githubUserActivityHistory.findMany({
      where: { githubId: { in: seededIds } },
      select: { githubId: true },
    });
    const failedRowPresent = rows.some(
      (row) => row.githubId === githubIdAt(24),
    );

    expect(result.failedUserCount).toBe(1);
    expect(rows).toHaveLength(ACTIVE_USER_COUNT - 1);
    expect(failedRowPresent).toBe(false);
  });
});
