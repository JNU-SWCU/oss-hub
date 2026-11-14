import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccountStatus, ActivityVisibility, type Prisma } from '@prisma/client';
import { DepartmentType, MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  CollectionCutoverRepository,
  CollectionUserActivityRepository,
} from '../github/repository-provision-job.repository';
import { PrismaService } from '../platform/prisma.service';
import {
  RankingRepository,
  type RankingMetricsQuery,
} from './ranking.repository';
import { RankingTimelineService } from './ranking-timeline.service';
import { RankingYearService } from './ranking-year.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const PREFIX = 'synthetic-ranking-timeline';
const YEAR = 2117;
const CLIMBER = { githubId: 9_117_001n, githubLogin: `${PREFIX}-climber` };
const LEADER = { githubId: 9_117_002n, githubLogin: `${PREFIX}-leader` };
const MEMBERS = [CLIMBER, LEADER];

const observe = (
  member: typeof CLIMBER,
  month: number,
  commitCount: number,
): Promise<void> =>
  new CollectionUserActivityRepository(
    prisma,
    new CollectionCutoverRepository(prisma),
  ).upsertObservation({
    ...member,
    year: YEAR,
    month,
    commitCount,
    pullRequestCount: 0,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
    observedAt: new Date(Date.UTC(YEAR, month - 1, 20)),
  });

async function purge(members: readonly (typeof CLIMBER)[]): Promise<void> {
  const githubIds = members.map((member) => member.githubId);
  await prisma.githubUserActivityMonthly.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });
}

async function createStudents(
  members: readonly (typeof CLIMBER)[],
): Promise<void> {
  for (const member of members) {
    await prisma.user.create({
      data: {
        id: member.githubLogin,
        githubId: member.githubId,
        nickname: member.githubLogin,
        accountStatus: AccountStatus.ACTIVE,
        name: '합성',
        studentId: member.githubId.toString(),
        department: PREFIX,
        type: MemberKind.STUDENT,
        departmentType: DepartmentType.DEPARTMENT,
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        approvalStatus: 'NOT_REQUIRED',
      },
    });
  }
}

beforeAll(async () => {
  await prisma.$connect();
  await purge(MEMBERS);
  await createStudents(MEMBERS);
});

afterAll(async () => {
  await purge(MEMBERS);
  await prisma.$disconnect();
});

it('수집이 달마다 남긴 값으로 순위 변화를 만들고, 같은 달 재수집은 덮어쓴다', async () => {
  await observe(CLIMBER, 1, 1);
  await observe(CLIMBER, 1, 10);
  await observe(LEADER, 1, 30);
  await observe(CLIMBER, 2, 50);
  await observe(LEADER, 2, 40);

  const service = new RankingTimelineService(
    new RankingRepository(prisma),
    new RankingYearService(),
  );
  const timeline = await service.findTimeline(
    YEAR,
    new Date(Date.UTC(YEAR + 1, 0, 1)),
  );

  expect(timeline.months).toEqual([1, 2, 12]);
  expect(timeline.series).toEqual([
    {
      githubLogin: CLIMBER.githubLogin,
      ranks: [2, 1, 1],
      totals: [10, 50, 50],
    },
    {
      githubLogin: LEADER.githubLogin,
      ranks: [1, 2, 2],
      totals: [30, 40, 40],
    },
  ]);
});

it('월별 값은 공개 수집값에 그 시점의 비공개 건수를 더한다', async () => {
  const repository = new CollectionUserActivityRepository(
    prisma,
    new CollectionCutoverRepository(prisma),
  );
  await repository.upsertPrivateObservation({
    ...CLIMBER,
    year: YEAR,
    commitCount: 7,
    pullRequestCount: 1,
    issueCount: 0,
    repositoryCount: 0,
    observedAt: new Date(Date.UTC(YEAR, 2, 1)),
  });
  await observe(CLIMBER, 3, 60);

  await expect(
    prisma.githubUserActivityMonthly.findUniqueOrThrow({
      where: {
        githubId_year_month: {
          githubId: CLIMBER.githubId,
          year: YEAR,
          month: 3,
        },
      },
      select: { commitCount: true, pullRequestCount: true },
    }),
  ).resolves.toEqual({ commitCount: 67, pullRequestCount: 1 });
  const snapshots = await new RankingRepository(prisma).findMonthlySnapshots(
    YEAR,
  );
  expect(
    snapshots.find(
      (row) => row.githubId === CLIMBER.githubId && row.month === 3,
    ),
  ).toMatchObject({ commitCount: 67, pullRequestCount: 1 });
});

describe('월별 기록을 활동 이력으로 옮긴다', () => {
  const BACKFILL_YEAR = 2026;
  const ALPHA = { githubId: 9_126_001n, githubLogin: `${PREFIX}-alpha` };
  const BETA = { githubId: 9_126_002n, githubLogin: `${PREFIX}-beta` };
  const PRIVATE_MEMBER = {
    githubId: 9_126_003n,
    githubLogin: `${PREFIX}-private`,
  };
  const BOUNDARY = { githubId: 9_126_004n, githubLogin: `${PREFIX}-boundary` };
  const ORPHAN = { githubId: 9_126_005n, githubLogin: `${PREFIX}-orphan` };
  const STALE = { githubId: 9_126_006n, githubLogin: `${PREFIX}-stale` };
  const MIXED = { githubId: 9_126_007n, githubLogin: `${PREFIX}-mixed` };
  const PRIVATE_ONLY = {
    githubId: 9_126_008n,
    githubLogin: `${PREFIX}-private-only`,
  };
  const BACKFILL_MEMBERS = [
    ALPHA,
    BETA,
    PRIVATE_MEMBER,
    BOUNDARY,
    ORPHAN,
    STALE,
    MIXED,
    PRIVATE_ONLY,
  ];
  const NOW = new Date('2026-11-14T03:00:00.000Z');
  const migrationSql = readFileSync(
    resolve(
      __dirname,
      '../../prisma/migrations/20261115040000_backfill_activity_history_from_monthly/migration.sql',
    ),
    'utf8',
  );
  const backfillBlock = migrationSql.slice(
    migrationSql.indexOf('DO $$'),
    migrationSql.lastIndexOf('$$;') + 2,
  );
  const ROLLED_BACK = new Error('rolled back');
  const withBackfill = async <T>(
    read: (
      repository: RankingRepository,
      transaction: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> => {
    let result: { readonly value: T } | undefined;
    await prisma
      .$transaction(
        async (transaction) => {
          await transaction.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
          await transaction.githubUserActivityMonthly.deleteMany({
            where: {
              year: BACKFILL_YEAR,
              githubId: { notIn: BACKFILL_MEMBERS.map((row) => row.githubId) },
            },
          });
          await transaction.$executeRawUnsafe(backfillBlock);
          result = {
            value: await read(
              new RankingRepository(transaction as unknown as PrismaService),
              transaction,
            ),
          };
          throw ROLLED_BACK;
        },
        { timeout: 30_000 },
      )
      .catch((error: unknown) => {
        if (error !== ROLLED_BACK) throw error;
      });
    if (result === undefined) throw new Error('Backfill did not run');
    return result.value;
  };
  const seoulMonthEnd = (month: number): Date =>
    new Date(Date.UTC(BACKFILL_YEAR, month, 1) - 9 * 60 * 60 * 1000 - 1);
  const monthly = (
    member: typeof ALPHA,
    month: number,
    commitCount: number,
    starCount = 0,
  ) => ({
    githubId: member.githubId,
    year: BACKFILL_YEAR,
    month,
    commitCount,
    pullRequestCount: 1,
    issueCount: 0,
    repositoryCount: 1,
    starCount,
    observedAt: seoulMonthEnd(month),
  });
  const history = (
    member: typeof ALPHA,
    visibility: ActivityVisibility,
    observedAt: string,
    commitCount: number,
    starCount = 0,
  ) => ({
    githubId: member.githubId,
    year: BACKFILL_YEAR,
    visibility,
    commitCount,
    pullRequestCount: 1,
    issueCount: 0,
    repositoryCount: 1,
    starCount,
    observedAt: new Date(observedAt),
  });
  const snapshotsOf = async (
    repository: RankingRepository,
    member: typeof ALPHA,
  ) =>
    (await repository.findMonthlySnapshots(BACKFILL_YEAR))
      .filter((row) => row.githubId === member.githubId)
      .sort((left, right) => left.month - right.month);
  const isFixture = (row: { readonly githubId: bigint }): boolean =>
    BACKFILL_MEMBERS.some((member) => member.githubId === row.githubId);
  const timeline = (
    repository: RankingRepository,
    findMonthlySnapshots: RankingRepository['findMonthlySnapshots'],
  ) =>
    new RankingTimelineService(
      {
        findMetrics: async (query: RankingMetricsQuery) =>
          (await repository.findMetrics(query)).filter(isFixture),
        findMonthlySnapshots,
      } as unknown as RankingRepository,
      new RankingYearService(),
    ).findTimeline(BACKFILL_YEAR, NOW);
  const readMonthlyTable = (year: number) =>
    prisma.githubUserActivityMonthly.findMany({
      where: { year },
      select: {
        githubId: true,
        month: true,
        commitCount: true,
        pullRequestCount: true,
        issueCount: true,
        repositoryCount: true,
        starCount: true,
      },
    });
  const previousRanks = async (repository: RankingRepository) =>
    (
      await repository.findPreviousCycleMetrics(
        { currentYear: BACKFILL_YEAR },
        NOW,
      )
    )
      .filter(isFixture)
      .sort((left, right) => Number(left.githubId - right.githubId));

  beforeAll(async () => {
    await purge(BACKFILL_MEMBERS);
    await createStudents([ALPHA, BETA, PRIVATE_MEMBER]);
  });

  afterAll(async () => {
    await purge(BACKFILL_MEMBERS);
  });

  it('11월 이후 공개 이력이 없는 사용자의 월별 행이 있으면 아무것도 옮기지 않고 멈춘다', async () => {
    await prisma.githubUserActivityMonthly.createMany({
      data: [monthly(ORPHAN, 1, 3), monthly(STALE, 1, 3)],
    });
    await prisma.githubUserActivityObservation.create({
      data: history(
        STALE,
        ActivityVisibility.PUBLIC,
        '2026-10-31T14:59:59.999Z',
        3,
      ),
    });

    await expect(withBackfill(() => Promise.resolve())).rejects.toThrow(
      /orphan_keys=2/,
    );

    const orphanIds = [ORPHAN.githubId, STALE.githubId];
    await prisma.githubUserActivityMonthly.deleteMany({
      where: { githubId: { in: orphanIds } },
    });
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: orphanIds } },
    });
  });

  it('1–10월을 공개 관측으로 옮기고 순위 변화와 이전 순위는 그대로다', async () => {
    const months = Array.from({ length: 10 }, (_, index) => index + 1);
    await prisma.githubUserActivityMonthly.createMany({
      data: [
        ...months.map((month) => monthly(ALPHA, month, month * 10 + 20, 4)),
        ...months
          .filter((month) => month !== 4)
          .map((month) => monthly(BETA, month, month * 15, 2)),
        ...months.map((month) => monthly(PRIVATE_MEMBER, month, month * 1000)),
        { ...monthly(ALPHA, 11, 125, 4), observedAt: new Date(NOW) },
      ],
    });
    await prisma.githubUserActivityObservation.createMany({
      data: [
        history(
          ALPHA,
          ActivityVisibility.PUBLIC,
          '2026-11-05T00:00:00Z',
          125,
          4,
        ),
        history(
          BETA,
          ActivityVisibility.PUBLIC,
          '2026-11-05T00:00:00Z',
          160,
          2,
        ),
        history(
          PRIVATE_MEMBER,
          ActivityVisibility.PRIVATE,
          '2026-11-01T03:00:00Z',
          7763,
          99,
        ),
        history(
          PRIVATE_MEMBER,
          ActivityVisibility.PUBLIC,
          '2026-11-10T00:00:00Z',
          11690,
          7,
        ),
      ],
    });
    const trunk = new RankingRepository(prisma);
    const before = await timeline(trunk, readMonthlyTable);
    const previousBefore = await previousRanks(trunk);

    const after = await withBackfill(async (repository, transaction) => {
      const backfilled = await transaction.githubUserActivityObservation.count({
        where: {
          githubId: { in: [ALPHA.githubId, BETA.githubId] },
          observedAt: { lt: new Date('2026-10-31T15:00:00.000Z') },
        },
      });
      await transaction.$executeRawUnsafe('SAVEPOINT rerun');
      const rerun = await transaction.$executeRawUnsafe(backfillBlock).then(
        () => 'applied twice',
        (error: unknown) => String(error),
      );
      await transaction.$executeRawUnsafe('ROLLBACK TO SAVEPOINT rerun');
      return {
        backfilled,
        rerun,
        timeline: await timeline(repository, (year) =>
          repository.findMonthlySnapshots(year),
        ),
        previous: await previousRanks(repository),
        beta: await snapshotsOf(repository, BETA),
        private: await snapshotsOf(repository, PRIVATE_MEMBER),
      };
    });

    expect(after.backfilled).toBe(19);
    expect(after.rerun).toMatch(/collisions=29/);
    expect(before.months).toEqual([...months, 11]);
    expect(
      before.series.find((series) => series.githubLogin === ALPHA.githubLogin)
        ?.ranks,
    ).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3]);
    expect(previousBefore).toHaveLength(3);
    expect(after.timeline).toEqual(before);
    expect(after.previous).toEqual(previousBefore);
    expect(after.beta.map((row) => row.month)).toEqual([
      1, 2, 3, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(after.private.find((row) => row.month === 10)).toMatchObject({
      commitCount: 10000,
      starCount: 0,
    });
    expect(after.private.find((row) => row.month === 11)).toMatchObject({
      commitCount: 19453,
      pullRequestCount: 2,
      starCount: 7,
    });
  });

  it('11월 마지막 관측이 12월 1일(KST) 뒤에 기록되면 12월 값이 된다', async () => {
    await prisma.githubUserActivityObservation.createMany({
      data: [
        history(
          BOUNDARY,
          ActivityVisibility.PUBLIC,
          '2026-11-30T14:59:59.999Z',
          1,
        ),
        history(
          BOUNDARY,
          ActivityVisibility.PUBLIC,
          '2026-11-30T15:00:00.000Z',
          2,
        ),
      ],
    });

    expect(
      (await snapshotsOf(new RankingRepository(prisma), BOUNDARY)).map(
        ({ month, commitCount }) => ({
          month,
          commitCount,
        }),
      ),
    ).toEqual([
      { month: 11, commitCount: 1 },
      { month: 12, commitCount: 2 },
    ]);
  });

  it('비공개 값만 바뀐 달도 월 값을 남기고, 비공개 이력만 있는 사용자는 월 값이 없다', async () => {
    await prisma.githubUserActivityObservation.createMany({
      data: [
        history(MIXED, ActivityVisibility.PUBLIC, '2026-01-10T00:00:00Z', 10),
        history(MIXED, ActivityVisibility.PRIVATE, '2026-02-15T00:00:00Z', 5),
        history(MIXED, ActivityVisibility.PUBLIC, '2026-03-03T00:00:00Z', 12),
        history(
          PRIVATE_ONLY,
          ActivityVisibility.PRIVATE,
          '2026-02-15T00:00:00Z',
          5,
        ),
      ],
    });
    const repository = new RankingRepository(prisma);

    expect(
      (await snapshotsOf(repository, MIXED)).map(({ month, commitCount }) => ({
        month,
        commitCount,
      })),
    ).toEqual([
      { month: 1, commitCount: 10 },
      { month: 2, commitCount: 15 },
      { month: 3, commitCount: 17 },
    ]);
    await expect(snapshotsOf(repository, PRIVATE_ONLY)).resolves.toEqual([]);
  });
});
