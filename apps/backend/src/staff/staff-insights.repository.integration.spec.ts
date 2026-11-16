import { ActivityVisibility } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { StaffInsightsRepository } from './staff-insights.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new StaffInsightsRepository(prisma);
const GITHUB_ID = 8_962_000_000_001n;
const YEAR = 2117;
const PUBLIC_ROW = {
  githubId: GITHUB_ID,
  year: YEAR,
  visibility: ActivityVisibility.PUBLIC,
  commitCount: 10,
  pullRequestCount: 2,
  issueCount: 1,
  repositoryCount: 1,
  starCount: 9,
  observedAt: new Date('2117-03-04T00:00:00.000Z'),
};
const PRIVATE_ROW = {
  ...PUBLIC_ROW,
  visibility: ActivityVisibility.PRIVATE,
  commitCount: 3,
  pullRequestCount: 4,
  issueCount: 5,
  repositoryCount: 6,
  starCount: 0,
  observedAt: new Date('2118-03-04T00:00:00.000Z'),
};

const BASELINE_GITHUB_ID = 8_962_000_000_002n;
const ACTIVE_STUDENT_ID = 'staff-insights-it-active-student';
const DEACTIVATED_STUDENT_ID = 'staff-insights-it-deactivated-student';
const CUTOFF = new Date('2117-06-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

async function purge(): Promise<void> {
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: [GITHUB_ID, BASELINE_GITHUB_ID] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ACTIVE_STUDENT_ID, DEACTIVATED_STUDENT_ID] } },
  });
}

function baselineObservation(
  visibility: ActivityVisibility,
  observedAt: Date,
  commitCount: number,
) {
  return {
    githubId: BASELINE_GITHUB_ID,
    year: YEAR,
    visibility,
    commitCount,
    pullRequestCount: commitCount + 1,
    issueCount: commitCount + 2,
    repositoryCount: commitCount + 3,
    starCount: 0,
    observedAt,
  };
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await purge();
  await prisma.githubUserActivityObservation.create({ data: PUBLIC_ROW });
});

afterEach(async () => {
  await purge();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('StaffInsightsRepository PUBLIC activity scope', () => {
  it.each([{ currentYear: YEAR }, { currentYear: undefined }] as const)(
    'preserves public counts and nine stars with year $currentYear',
    async ({ currentYear }) => {
      await prisma.githubUserActivityObservation.create({ data: PRIVATE_ROW });

      const rows = await repository.listActivityTotals({ currentYear });

      expect(rows.find((row) => row.githubId === GITHUB_ID)).toEqual({
        githubId: GITHUB_ID,
        commitCount: 10,
        pullRequestCount: 2,
        issueCount: 1,
        repositoryCount: 1,
        starCount: 9,
      });
    },
  );

  it('does not expose a private-only year in staff filters', async () => {
    const before = await repository.listActivityYears();
    await prisma.githubUserActivityObservation.create({
      data: { ...PRIVATE_ROW, year: YEAR + 1 },
    });

    const years = await repository.listActivityYears();

    expect(years).toEqual(before);
    expect(years).toContain(YEAR);
    expect(years).not.toContain(YEAR + 1);
  });

  it('does not advance staff freshness on a private observation', async () => {
    const before = await repository.findActivityDataAsOf();
    await prisma.githubUserActivityObservation.create({ data: PRIVATE_ROW });

    const dataAsOf = await repository.findActivityDataAsOf();

    expect(dataAsOf).toEqual(before);
    expect(dataAsOf).toEqual(PUBLIC_ROW.observedAt);
  });
});

describe('StaffInsightsRepository student identity and baselines', () => {
  it('returns githubLogin and name for active students only', async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ACTIVE_STUDENT_ID,
          githubId: GITHUB_ID,
          nickname: 'insights-active',
          type: 'STUDENT',
          name: '홍길동',
          department: '소프트웨어공학과',
          departmentType: 'DEPARTMENT',
          profileCreatedAt: CUTOFF,
          profileUpdatedAt: CUTOFF,
        },
        {
          id: DEACTIVATED_STUDENT_ID,
          githubId: BASELINE_GITHUB_ID,
          nickname: 'insights-deactivated',
          type: 'STUDENT',
          name: '김비활',
          department: '소프트웨어공학과',
          departmentType: 'DEPARTMENT',
          profileCreatedAt: CUTOFF,
          profileUpdatedAt: CUTOFF,
          accountStatus: 'DEACTIVATED',
        },
      ],
    });

    const students = await repository.listStudents();

    expect(students.find((row) => row.id === ACTIVE_STUDENT_ID)).toEqual({
      id: ACTIVE_STUDENT_ID,
      githubId: GITHUB_ID,
      githubLogin: 'insights-active',
      name: '홍길동',
      department: '소프트웨어공학과',
    });
    expect(students.some((row) => row.id === DEACTIVATED_STUDENT_ID)).toBe(
      false,
    );
  });

  it('reads the baseline strictly before the cutoff and the latest standing', async () => {
    await prisma.githubUserActivityObservation.createMany({
      data: [
        baselineObservation(
          ActivityVisibility.PUBLIC,
          new Date(CUTOFF.getTime() - 2 * DAY_MS),
          10,
        ),
        baselineObservation(ActivityVisibility.PUBLIC, CUTOFF, 20),
        baselineObservation(
          ActivityVisibility.PUBLIC,
          new Date(CUTOFF.getTime() + 5 * DAY_MS),
          30,
        ),
        baselineObservation(
          ActivityVisibility.PRIVATE,
          new Date(CUTOFF.getTime() - DAY_MS),
          99,
        ),
      ],
    });
    const countsOf = (commitCount: number) => ({
      githubId: BASELINE_GITHUB_ID,
      year: YEAR,
      commitCount,
      pullRequestCount: commitCount + 1,
      issueCount: commitCount + 2,
      repositoryCount: commitCount + 3,
    });

    const baselines = await repository.listActivityBaselines(YEAR, CUTOFF);
    const current = await repository.listActivityByYear(YEAR);

    expect(
      baselines.filter((row) => row.githubId === BASELINE_GITHUB_ID),
    ).toEqual([countsOf(10)]);
    expect(
      current.filter((row) => row.githubId === BASELINE_GITHUB_ID),
    ).toEqual([countsOf(30)]);
  });
});
