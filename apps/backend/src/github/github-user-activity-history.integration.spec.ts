import { PrismaClient } from '@prisma/client';

import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

describe('GithubUserActivityHistory (실 Postgres)', () => {
  const prisma = new PrismaClient();

  const GITHUB_ID = 9_930_000_001n;
  const OTHER_YEAR = 2025;
  const YEAR = 2026;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.githubUserActivityHistory.deleteMany({
      where: { githubId: GITHUB_ID },
    });
  });

  it('같은 (githubId, year) 재관측은 행을 늘리지 않고 전량 덮어쓴다', async () => {
    const firstObservedAt = new Date('2026-08-19T00:00:00.000Z');
    const secondObservedAt = new Date('2026-08-19T01:00:00.000Z');

    const created = await prisma.githubUserActivityHistory.upsert({
      where: { githubId_year: { githubId: GITHUB_ID, year: YEAR } },
      create: {
        githubId: GITHUB_ID,
        githubLogin: 'synthetic-login',
        year: YEAR,
        commitCount: 10,
        pullRequestCount: 2,
        issueCount: 3,
        repositoryCount: 4,
        starCount: 5,
        observedAt: firstObservedAt,
      },
      update: {},
    });

    expect(created).toEqual(
      expect.objectContaining({
        commitCount: 10,
        githubLogin: 'synthetic-login',
        issueCount: 3,
        observedAt: firstObservedAt,
        pullRequestCount: 2,
        repositoryCount: 4,
        starCount: 5,
      }),
    );

    const updated = await prisma.githubUserActivityHistory.upsert({
      where: { githubId_year: { githubId: GITHUB_ID, year: YEAR } },
      create: {
        githubId: GITHUB_ID,
        githubLogin: 'synthetic-login',
        year: YEAR,
        observedAt: secondObservedAt,
      },
      update: {
        githubLogin: 'synthetic-login-renamed',
        commitCount: 11,
        pullRequestCount: 2,
        issueCount: 3,
        repositoryCount: 4,
        starCount: 7,
        observedAt: secondObservedAt,
      },
    });

    expect(updated).toEqual(
      expect.objectContaining({
        commitCount: 11,
        githubLogin: 'synthetic-login-renamed',
        observedAt: secondObservedAt,
        starCount: 7,
      }),
    );

    await expect(
      prisma.githubUserActivityHistory.count({
        where: { githubId: GITHUB_ID },
      }),
    ).resolves.toBe(1);
  });

  it('연도가 다르면 같은 사람이라도 행이 쌓인다', async () => {
    await prisma.githubUserActivityHistory.createMany({
      data: [
        {
          githubId: GITHUB_ID,
          githubLogin: 'synthetic-login',
          year: OTHER_YEAR,
          observedAt: new Date('2025-12-31T15:00:00.000Z'),
        },
        {
          githubId: GITHUB_ID,
          githubLogin: 'synthetic-login',
          year: YEAR,
          observedAt: new Date('2026-08-19T00:00:00.000Z'),
        },
      ],
    });

    const years = await prisma.githubUserActivityHistory.findMany({
      where: { githubId: GITHUB_ID },
      orderBy: { year: 'asc' },
      select: { year: true },
    });

    expect(years.map((row) => row.year)).toEqual([OTHER_YEAR, YEAR]);
  });

  it('같은 (githubId, year) 중복 insert 는 기본키가 거부한다', async () => {
    await prisma.githubUserActivityHistory.create({
      data: {
        githubId: GITHUB_ID,
        githubLogin: 'synthetic-login',
        year: YEAR,
        observedAt: new Date('2026-08-19T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.githubUserActivityHistory.create({
        data: {
          githubId: GITHUB_ID,
          githubLogin: 'synthetic-login-duplicate',
          year: YEAR,
          observedAt: new Date('2026-08-19T02:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.githubUserActivityHistory.count({
        where: { githubId: GITHUB_ID },
      }),
    ).resolves.toBe(1);
  });
});
