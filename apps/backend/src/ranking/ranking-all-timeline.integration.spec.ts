import { ActivityVisibility } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import type { OptionalSessionRequest } from '../auth/http-auth.types';
import { HTTP_AUTH_KINDS } from '../platform/auth.config';
import { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';
import { RankingTimelineService } from './ranking-timeline.service';
import { RankingYearService } from './ranking-year.service';

import { CollectionUserActivityRepository } from '../github/collection-user-activity.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const ranking = new RankingRepository(prisma);
const timeline = new RankingTimelineService(ranking, new RankingYearService());
const anonymousAuth = {
  kind: HTTP_AUTH_KINDS.ANONYMOUS,
  hasSessionCookie: false,
} as OptionalSessionRequest['auth'];
const MINA = { githubId: 9_118_001n, nickname: 'synthetic-all-mina' };
const SUHO = { githubId: 9_118_002n, nickname: 'synthetic-all-suho' };
const members = [MINA, SUHO];
const profileAt = new Date('2024-01-01T00:00:00Z');

async function clearObservations(): Promise<void> {
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: members.map(({ githubId }) => githubId) } },
  });
}

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.createMany({
    data: members.map((member) => ({
      ...member,
      id: member.nickname,
      studentId: member.githubId.toString(),
      type: 'STUDENT',
      name: 'Synthetic student',
      department: 'Synthetic department',
      departmentType: 'DEPARTMENT',
      profileCreatedAt: profileAt,
      profileUpdatedAt: profileAt,
    })),
  });
});

afterEach(clearObservations);

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { githubId: { in: members.map(({ githubId }) => githubId) } },
  });
  await prisma.$disconnect();
});

function observation(
  member: typeof MINA,
  year: number,
  observedAt: string,
  counts: {
    readonly commits: number;
    readonly stars?: number;
    readonly private?: boolean;
  },
) {
  return {
    githubId: member.githubId,
    year,
    visibility: counts.private
      ? ActivityVisibility.PRIVATE
      : ActivityVisibility.PUBLIC,
    observedAt: new Date(observedAt),
    commitCount: counts.commits,
    starCount: counts.stars ?? 0,
  };
}

it('folds each observed cutoff across years and ends at the current All leaderboard', async () => {
  await prisma.githubUserActivityObservation.createMany({
    data: [
      observation(MINA, 2024, '2024-12-20T00:00:00Z', {
        commits: 10,
        stars: 30,
      }),
      observation(MINA, 2024, '2024-12-21T00:00:00Z', {
        commits: 2,
        private: true,
      }),
      observation(SUHO, 2024, '2024-12-31T14:59:59Z', {
        commits: 15,
        stars: 1,
      }),
      observation(MINA, 2025, '2024-12-31T15:00:00Z', { commits: 3, stars: 5 }),
      observation(SUHO, 2025, '2025-01-20T00:00:00Z', {
        commits: 20,
        stars: 1,
      }),
      observation(MINA, 2023, '2025-03-20T00:00:00Z', {
        commits: 40,
        stars: 200,
      }),
    ],
  });

  const all = await timeline.findTimelineFromRequest(
    { year: 'all' },
    anonymousAuth,
  );

  expect(all).toEqual({
    year: 'all',
    periods: ['2024-12', '2025-01', '2025-02', '2025-03'].map((month) => ({
      fromMonth: month,
      toMonth: month,
    })),
    series: [
      {
        githubLogin: MINA.nickname,
        ranks: [1, 2, null, 1],
        totals: [42, 20, null, 60],
      },
      {
        githubLogin: SUHO.nickname,
        ranks: [2, 1, null, 2],
        totals: [16, 36, null, 36],
      },
    ],
  });
  await new CollectionUserActivityRepository(prisma).refreshRankingSnapshots();
  const leaderboard = await ranking.findRankedPage(
    {},
    { offset: 0, limit: 2 },
    new Date(),
  );
  expect(
    all.series.map((line) => [
      line.githubLogin,
      line.ranks.at(-1),
      line.totals.at(-1),
    ]),
  ).toEqual(
    leaderboard.rows.map((row) => [row.githubLogin, row.rank, row.total]),
  );
});

it('coarsens the full span and keeps the earliest and latest observations', async () => {
  await prisma.githubUserActivityObservation.createMany({
    data: [
      observation(MINA, 2020, '2020-01-20T00:00:00Z', {
        commits: 10,
        stars: 3,
      }),
      {
        ...observation(MINA, 2026, '2026-11-20T00:00:00Z', {
          commits: 15,
          stars: 4,
        }),
        clockAt: new Date('2026-12-20T00:00:00Z'),
      },
    ],
  });
  const all = await timeline.findTimelineFromRequest(
    { year: 'all' },
    anonymousAuth,
  );
  expect(all).toMatchObject({
    year: 'all',
    series: [
      {
        githubLogin: MINA.nickname,
        totals: [13, ...Array<null>(10).fill(null), 29],
      },
    ],
  });
  if (all.year !== 'all') throw new Error('Expected the All timeline');
  expect(all.periods).toHaveLength(12);
  expect(all.periods[0]).toEqual({ fromMonth: '2020-01', toMonth: '2020-07' });
  expect(all.periods.at(-1)).toEqual({
    fromMonth: '2026-06',
    toMonth: '2026-12',
  });
});

it('does not fabricate a chart without stored observations', async () => {
  await expect(
    timeline.findTimelineFromRequest({ year: 'all' }, anonymousAuth),
  ).resolves.toEqual({
    year: 'all',
    periods: [],
    series: [],
  });
});
