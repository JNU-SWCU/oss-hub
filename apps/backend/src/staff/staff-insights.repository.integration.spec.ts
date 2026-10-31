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
  githubLogin: 'synthetic-staff-insights-visibility',
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

async function purge(): Promise<void> {
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: GITHUB_ID },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await purge();
  await prisma.githubUserActivityHistory.create({ data: PUBLIC_ROW });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await purge();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('StaffInsightsRepository PUBLIC activity scope', () => {
  it.each([
    { order: 'asc', currentYear: YEAR },
    { order: 'desc', currentYear: YEAR },
    { order: 'asc', currentYear: undefined },
    { order: 'desc', currentYear: undefined },
  ] as const)(
    'preserves public counts and nine stars with visibility $order, year $currentYear',
    async ({ order, currentYear }) => {
      await prisma.githubUserActivityHistory.create({ data: PRIVATE_ROW });
      const findMany = prisma.githubUserActivityHistory.findMany.bind(
        prisma.githubUserActivityHistory,
      );
      jest
        .spyOn(prisma.githubUserActivityHistory, 'findMany')
        .mockImplementation((args) =>
          findMany({ ...args, orderBy: { visibility: order } }),
        );

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
    await prisma.githubUserActivityHistory.create({
      data: { ...PRIVATE_ROW, year: YEAR + 1 },
    });

    const years = await repository.listActivityYears();

    expect(years).toEqual(before);
    expect(years).toContain(YEAR);
    expect(years).not.toContain(YEAR + 1);
  });

  it('does not advance staff freshness on a private observation', async () => {
    const before = await repository.findActivityDataAsOf();
    await prisma.githubUserActivityHistory.create({ data: PRIVATE_ROW });

    const dataAsOf = await repository.findActivityDataAsOf();

    expect(dataAsOf).toEqual(before);
    expect(dataAsOf).toEqual(PUBLIC_ROW.observedAt);
  });
});
