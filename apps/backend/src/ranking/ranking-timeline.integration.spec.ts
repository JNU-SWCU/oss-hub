import { AccountStatus, ActivityVisibility } from '@prisma/client';
import { DepartmentType, MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  CollectionCutoverRepository,
  CollectionUserActivityRepository,
} from '../github/repository-provision-job.repository';
import { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';
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
const BOUNDARY = { githubId: 9_117_003n, githubLogin: `${PREFIX}-boundary` };
const MIXED = { githubId: 9_117_004n, githubLogin: `${PREFIX}-mixed` };
const PRIVATE_ONLY = {
  githubId: 9_117_005n,
  githubLogin: `${PREFIX}-private-only`,
};
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
    commitCount,
    pullRequestCount: 0,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
    observedAt: new Date(Date.UTC(YEAR, month - 1, 20)),
  });

async function purge(members: readonly (typeof CLIMBER)[]): Promise<void> {
  const githubIds = members.map((member) => member.githubId);
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
  await purge([...MEMBERS, BOUNDARY, MIXED, PRIVATE_ONLY]);
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

  const snapshots = await new RankingRepository(prisma).findMonthlySnapshots(
    YEAR,
  );
  expect(
    snapshots.find(
      (row) => row.githubId === CLIMBER.githubId && row.month === 3,
    ),
  ).toMatchObject({ commitCount: 67, pullRequestCount: 1 });
});

it('11월 마지막 관측이 12월 1일(KST) 뒤에 기록되면 12월 값이 된다', async () => {
  const observation = (observedAt: Date, commitCount: number) => ({
    githubId: BOUNDARY.githubId,
    year: YEAR,
    visibility: ActivityVisibility.PUBLIC,
    commitCount,
    observedAt,
  });
  await prisma.githubUserActivityObservation.createMany({
    data: [
      observation(new Date(Date.UTC(YEAR, 10, 30, 14, 59, 59, 999)), 1),
      observation(new Date(Date.UTC(YEAR, 10, 30, 15)), 2),
    ],
  });

  const snapshots = await new RankingRepository(prisma).findMonthlySnapshots(
    YEAR,
  );

  expect(
    snapshots
      .filter((row) => row.githubId === BOUNDARY.githubId)
      .map(({ month, commitCount }) => ({ month, commitCount }))
      .sort((left, right) => left.month - right.month),
  ).toEqual([
    { month: 11, commitCount: 1 },
    { month: 12, commitCount: 2 },
  ]);
});

it('비공개 값만 바뀐 달도 월 값을 남기고, 비공개 이력만 있는 사용자는 월 값이 없다', async () => {
  const observation = (
    member: typeof CLIMBER,
    visibility: ActivityVisibility,
    observedAt: Date,
    commitCount: number,
  ) => ({
    githubId: member.githubId,
    year: YEAR,
    visibility,
    commitCount,
    observedAt,
  });
  const { PUBLIC, PRIVATE } = ActivityVisibility;
  await prisma.githubUserActivityObservation.createMany({
    data: [
      observation(MIXED, PUBLIC, new Date(Date.UTC(YEAR, 0, 10)), 10),
      observation(MIXED, PRIVATE, new Date(Date.UTC(YEAR, 1, 15)), 5),
      observation(MIXED, PUBLIC, new Date(Date.UTC(YEAR, 2, 3)), 12),
      observation(PRIVATE_ONLY, PRIVATE, new Date(Date.UTC(YEAR, 1, 15)), 5),
    ],
  });

  const snapshots = await new RankingRepository(prisma).findMonthlySnapshots(
    YEAR,
  );

  expect(
    snapshots
      .filter((row) => row.githubId === MIXED.githubId)
      .map(({ month, commitCount }) => ({ month, commitCount }))
      .sort((left, right) => left.month - right.month),
  ).toEqual([
    { month: 1, commitCount: 10 },
    { month: 2, commitCount: 15 },
    { month: 3, commitCount: 17 },
  ]);
  expect(
    snapshots.filter((row) => row.githubId === PRIVATE_ONLY.githubId),
  ).toEqual([]);
});
