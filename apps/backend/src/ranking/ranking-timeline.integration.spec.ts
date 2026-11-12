import { AccountStatus } from '@prisma/client';
import { DepartmentType, MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { CollectionUserActivityRepository } from '../github/repository-provision-job.repository';
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
const MEMBERS = [CLIMBER, LEADER];

const observe = (
  member: typeof CLIMBER,
  month: number,
  commitCount: number,
): Promise<void> =>
  new CollectionUserActivityRepository(prisma).upsertObservation({
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

async function purge(): Promise<void> {
  const githubIds = MEMBERS.map((member) => member.githubId);
  await prisma.githubUserActivityMonthly.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: githubIds } },
  });
  await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await purge();
  for (const member of MEMBERS) {
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
});

afterAll(async () => {
  await purge();
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
  const repository = new CollectionUserActivityRepository(prisma);
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
});
