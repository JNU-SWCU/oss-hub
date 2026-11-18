import { ActivityVisibility } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';
import { RankingYearService } from './ranking-year.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new RankingService(
  new RankingRepository(prisma),
  new RankingYearService(),
  new CollectionScheduleService(),
);

const PREFIX = 'synthetic-ranked-page';
const ORDER_YEAR = 2115;
const PREVIOUS_YEAR = 2114;
const NO_PREVIOUS_YEAR = 2113;
const BASE_ID = 8_960_000_000_000n;
const HOUR_MS = 60 * 60 * 1000;

interface Metrics {
  readonly commitCount?: number;
  readonly pullRequestCount?: number;
  readonly issueCount?: number;
  readonly repositoryCount?: number;
  readonly starCount?: number;
}

const STUDENTS = [
  { offset: 30n, login: 'top' },
  { offset: 23n, login: 'c' },
  { offset: 2n, login: 'same' },
  { offset: 10n, login: 'Same' },
  { offset: 22n, login: 'b' },
  { offset: 21n, login: 'a' },
  { offset: 20n, login: 'z' },
  { offset: 40n, login: 'leader' },
  { offset: 41n, login: 'climber' },
  { offset: 50n, login: 'alpha' },
  { offset: 51n, login: 'beta' },
  { offset: 60n, login: 'fresh-signup' },
] as const;

const githubIdOf = (login: string): bigint => {
  const student = STUDENTS.find((candidate) => candidate.login === login);
  if (student === undefined) throw new Error(`unknown student ${login}`);
  return BASE_ID + student.offset;
};
const loginOf = (login: string): string => `${PREFIX}-${login}`;
const ids = STUDENTS.map((student) => BASE_ID + student.offset);

async function observe(
  login: string,
  year: number,
  metrics: Metrics,
  observedAt: Date,
  visibility: ActivityVisibility = ActivityVisibility.PUBLIC,
): Promise<void> {
  await prisma.githubUserActivityObservation.create({
    data: {
      githubId: githubIdOf(login),
      year,
      visibility,
      commitCount: metrics.commitCount ?? 0,
      pullRequestCount: metrics.pullRequestCount ?? 0,
      issueCount: metrics.issueCount ?? 0,
      repositoryCount: metrics.repositoryCount ?? 0,
      starCount: metrics.starCount ?? 0,
      observedAt,
    },
  });
}

async function purge(): Promise<void> {
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: ids } },
  });
  await prisma.user.deleteMany({ where: { githubId: { in: ids } } });
}

async function allItems(year: number) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const result = await service.findPage(year, page, 50, null);
    items.push(...result.items);
    if (page * 50 >= result.total) return { items, total: result.total };
  }
}

const synthetic = <T extends { readonly githubLogin: string }>(
  items: readonly T[],
): T[] => items.filter((item) => item.githubLogin.startsWith(`${PREFIX}-`));

beforeAll(async () => {
  await prisma.$connect();
  await purge();
  await prisma.user.createMany({
    data: STUDENTS.map((student) => ({
      id: `${PREFIX}-${student.offset}`,
      githubId: BASE_ID + student.offset,
      nickname: loginOf(student.login),
      type: 'STUDENT' as const,
    })),
  });
  const now = new Date();
  const yesterday = new Date(now.getTime() - 36 * HOUR_MS);
  await observe('top', ORDER_YEAR, { commitCount: 6 }, now);
  for (const login of ['c', 'same', 'Same']) {
    await observe(
      login,
      ORDER_YEAR,
      { commitCount: 3, pullRequestCount: 1, issueCount: 1 },
      now,
    );
  }
  await observe(
    'b',
    ORDER_YEAR,
    { commitCount: 3, pullRequestCount: 1, issueCount: 0 },
    now,
  );
  await observe(
    'a',
    ORDER_YEAR,
    { commitCount: 3, pullRequestCount: 0, issueCount: 1 },
    now,
  );
  await observe(
    'z',
    ORDER_YEAR,
    { commitCount: 2, pullRequestCount: 1, issueCount: 1 },
    now,
  );
  await observe('leader', ORDER_YEAR, { commitCount: 20, starCount: 1 }, now);
  await observe('climber', ORDER_YEAR, { commitCount: 10, starCount: 2 }, now);
  await observe(
    'climber',
    ORDER_YEAR,
    { commitCount: 15, pullRequestCount: 3, starCount: 50 },
    now,
    ActivityVisibility.PRIVATE,
  );
  await observe('alpha', PREVIOUS_YEAR, { commitCount: 5 }, yesterday);
  await observe('beta', PREVIOUS_YEAR, { commitCount: 1 }, yesterday);
  await observe('alpha', PREVIOUS_YEAR, { commitCount: 5 }, now);
  await observe('beta', PREVIOUS_YEAR, { commitCount: 9 }, now);
  await observe('alpha', NO_PREVIOUS_YEAR, { commitCount: 5 }, now);
});

afterAll(async () => {
  await purge();
  await prisma.$disconnect();
});

describe('RankingRepository.findRankedPage — SQL ranking', () => {
  it('orders every tie level, then normalized login, then numeric GitHub id', async () => {
    const page = await service.findPage(ORDER_YEAR, 1, 9, null);

    expect(page.items.map((item) => item.githubLogin)).toEqual(
      ['climber', 'leader', 'top', 'c', 'same', 'Same', 'b', 'a', 'z'].map(
        loginOf,
      ),
    );
    expect(page.items.map((item) => item.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it('sums PRIVATE counts into the total and takes stars from PUBLIC only', async () => {
    const page = await service.findPage(ORDER_YEAR, 1, 2, null);

    expect(page.items).toEqual([
      expect.objectContaining({
        githubLogin: loginOf('climber'),
        commitCount: 25,
        pullRequestCount: 3,
        starCount: 2,
        total: 30,
      }),
      expect.objectContaining({
        githubLogin: loginOf('leader'),
        total: 21,
      }),
    ]);
  });

  it('keeps a student without activity in the ranking with zero metrics', async () => {
    const { items } = await allItems(ORDER_YEAR);

    expect(
      items.find((item) => item.githubLogin === loginOf('fresh-signup')),
    ).toMatchObject({
      commitCount: 0,
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
      total: 0,
    });
  });

  it('pages through every eligible student exactly once and matches the total', async () => {
    const { items, total } = await allItems(ORDER_YEAR);
    const ranks = items.map((item) => item.rank);

    expect(items).toHaveLength(total);
    expect(new Set(ranks).size).toBe(total);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
    expect(synthetic(items)).toHaveLength(STUDENTS.length);
  });

  it('carries the rank from the latest observations before today as previousRank', async () => {
    const page = await service.findPage(PREVIOUS_YEAR, 1, 2, null);

    expect(
      page.items.map(({ githubLogin, rank, previousRank }) => ({
        githubLogin,
        rank,
        previousRank,
      })),
    ).toEqual([
      { githubLogin: loginOf('beta'), rank: 1, previousRank: 2 },
      { githubLogin: loginOf('alpha'), rank: 2, previousRank: 1 },
    ]);
  });

  it('leaves previousRank null when no observation exists before today', async () => {
    const page = await service.findPage(NO_PREVIOUS_YEAR, 1, 1, null);

    expect(page.items).toEqual([
      expect.objectContaining({
        githubLogin: loginOf('alpha'),
        rank: 1,
        previousRank: null,
      }),
    ]);
  });
});
