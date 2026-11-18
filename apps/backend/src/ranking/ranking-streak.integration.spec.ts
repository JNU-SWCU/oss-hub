import { ActivityVisibility } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { PrismaService } from '../platform/prisma.service';
import { RankingRepository } from './ranking.repository';
import { RankingService } from './ranking.service';
import { RankingYearService, RANKING_YEAR_ALL } from './ranking-year.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

jest.setTimeout(180_000);

const prisma = new PrismaService();
const repository = new RankingRepository(prisma);
const service = new RankingService(
  repository,
  new RankingYearService(),
  new CollectionScheduleService(),
);

const PREFIX = 'synthetic-ranking-streak';
const BASE_ID = 8_970_000_000_000n;
const START = new Date('2098-01-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(START.getTime() + 400 * DAY_MS + 12 * 60 * 60 * 1000);
const students = Array.from({ length: 12 }, (_, index) => ({
  githubId: BASE_ID + BigInt(index + 1),
  login: `${PREFIX}-${String(index + 1).padStart(2, '0')}`,
  score: 11_000 - index * 1_000,
}));
const ids = students.map((student) => student.githubId);

function studentAt(index: number) {
  const student = students[index];
  if (student === undefined) throw new TypeError(`Missing student ${index}`);
  return student;
}

const LEADER = studentAt(0);
const CHALLENGER = studentAt(1);
const TIE_FIRST = studentAt(2);
const TIE_SECOND = studentAt(3);
const TENTH = studentAt(9);
const ELEVENTH = studentAt(10);
const TWELFTH = studentAt(11);

function atDay(day: number): Date {
  return new Date(START.getTime() + day * DAY_MS);
}

async function purge(): Promise<void> {
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { in: ids } },
  });
  await prisma.user.deleteMany({ where: { githubId: { in: ids } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await purge();
  await prisma.user.createMany({
    data: students.map((student) => ({
      id: `${PREFIX}-${student.githubId}`,
      githubId: student.githubId,
      nickname: student.login,
      type: 'STUDENT' as const,
    })),
  });

  const observations = students.map((student) => ({
    githubId: student.githubId,
    year: 2098,
    visibility: ActivityVisibility.PUBLIC,
    commitCount: student.score,
    observedAt: START,
  }));
  for (let day = 1; day <= 400; day += 1) {
    observations.push({
      githubId: LEADER.githubId,
      year: 2098,
      visibility: ActivityVisibility.PUBLIC,
      commitCount: day >= 201 ? 11_002 : 11_000,
      observedAt: atDay(day),
    });
  }
  observations.push(
    {
      githubId: CHALLENGER.githubId,
      year: 2098,
      visibility: ActivityVisibility.PUBLIC,
      commitCount: 11_001,
      observedAt: atDay(200),
    },
    {
      githubId: ELEVENTH.githubId,
      year: 2098,
      visibility: ActivityVisibility.PUBLIC,
      commitCount: 2_100,
      observedAt: atDay(390),
    },
    {
      githubId: TENTH.githubId,
      year: 2098,
      visibility: ActivityVisibility.PUBLIC,
      commitCount: 2_200,
      observedAt: atDay(395),
    },
  );
  await prisma.githubUserActivityObservation.createMany({ data: observations });
}, 30_000);

afterAll(async () => {
  await purge();
  await prisma.$disconnect();
}, 30_000);

test('400일 이력에서 현재 동일 순위와 TOP 10 연속 시작을 서울 날짜로 계산한다', async () => {
  const page = await service.findPage(RANKING_YEAR_ALL, 1, 12, null, NOW);
  const synthetic = page.items.filter((item) =>
    item.githubLogin.startsWith(PREFIX),
  );

  expect(synthetic).toHaveLength(12);
  expect(synthetic[0]).toMatchObject({
    rank: 1,
    streak: {
      rankHeldSince: '2098-07-21',
      top10Since: '2098-01-01',
      rankHeldDays: 200,
      top10Days: 401,
    },
  });
  expect(synthetic[9]).toMatchObject({
    rank: 10,
    streak: {
      rankHeldSince: '2099-01-31',
      top10Since: '2099-01-31',
      rankHeldDays: 6,
      top10Days: 6,
    },
  });
  expect(synthetic[10]).not.toHaveProperty('streak');
  expect(synthetic[11]).not.toHaveProperty('streak');
});

test('동점은 기존 login·github id 규칙으로 결정되고 행 순서가 달라도 결과가 같다', async () => {
  await prisma.githubUserActivityObservation.createMany({
    data: [
      {
        githubId: TIE_FIRST.githubId,
        year: 2098,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 8_000,
        observedAt: atDay(400),
      },
      {
        githubId: TIE_SECOND.githubId,
        year: 2098,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 8_000,
        observedAt: atDay(400),
      },
    ],
  });

  const first = await repository.findRankedPage(
    {},
    { offset: 0, limit: 10 },
    NOW,
  );
  const second = await repository.findRankedPage(
    {},
    { offset: 0, limit: 10 },
    NOW,
  );

  expect(second.rows).toEqual(first.rows);
  expect(first.rows.map((row) => row.githubLogin).slice(2, 4)).toEqual([
    TIE_FIRST.login,
    TIE_SECOND.login,
  ]);
});

test('선택 연도의 관측 원장이 비어 있으면 TOP 10 streak가 null이다', async () => {
  const page = await service.findPage(
    2099,
    1,
    10,
    null,
    new Date('2099-06-01T00:00:00.000Z'),
  );

  expect(page.items).toHaveLength(10);
  expect(page.items.every((item) => item.streak === null)).toBe(true);
});

test('서울 자정 직후 시작한 동일 순위 run은 시작일을 포함해 계산한다', async () => {
  const beforeMidnight = new Date('2100-01-01T14:59:00.000Z');
  const midnight = new Date('2100-01-01T15:00:00.000Z');
  await prisma.githubUserActivityObservation.createMany({
    data: [
      ...students.map((student, index) => ({
        githubId: student.githubId,
        year: 2100,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: index === 0 ? 9_000 : 11_000 - index * 1_000,
        observedAt: beforeMidnight,
      })),
      {
        githubId: LEADER.githubId,
        year: 2100,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 12_000,
        observedAt: midnight,
      },
    ],
  });

  try {
    const page = await service.findPage(
      2100,
      1,
      10,
      null,
      new Date('2100-01-02T15:00:00.000Z'),
    );

    expect(page.items[0]).toMatchObject({
      githubLogin: LEADER.login,
      streak: {
        rankHeldSince: '2100-01-02',
        top10Since: '2100-01-01',
        rankHeldDays: 2,
        top10Days: 3,
      },
    });
  } finally {
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: ids }, year: 2100 },
    });
  }
});

test('선택 연도 밖 backfill로 현재 순위가 바뀌면 오래된 run을 노출하지 않는다', async () => {
  const withinYear = new Date('2099-06-01T00:00:00.000Z');
  const afterYear = new Date('2100-01-02T00:00:00.000Z');
  await prisma.githubUserActivityObservation.createMany({
    data: [
      ...students.map((student, index) => ({
        githubId: student.githubId,
        year: 2099,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: index === 0 ? 9_000 : 11_000 - index * 1_000,
        observedAt: withinYear,
      })),
      {
        githubId: LEADER.githubId,
        year: 2099,
        visibility: ActivityVisibility.PUBLIC,
        commitCount: 12_000,
        observedAt: afterYear,
      },
    ],
  });

  try {
    const page = await service.findPage(
      2099,
      1,
      10,
      null,
      new Date('2100-01-03T00:00:00.000Z'),
    );

    expect(page.items[0]).toMatchObject({
      githubLogin: LEADER.login,
      rank: 1,
      streak: null,
    });
  } finally {
    await prisma.githubUserActivityObservation.deleteMany({
      where: { githubId: { in: ids }, year: 2099 },
    });
  }
});

test('1배와 10배 관측 이력 모두 한 ranking SQL과 한 count 문장만 실행한다', async () => {
  const rawQuery = jest.spyOn(prisma, '$queryRaw');
  const countQuery = jest.spyOn(prisma.user, 'count');

  rawQuery.mockClear();
  countQuery.mockClear();
  await repository.findRankedPage({}, { offset: 0, limit: 10 }, NOW);
  const oneTimes = {
    raw: rawQuery.mock.calls.length,
    count: countQuery.mock.calls.length,
  };

  await prisma.githubUserActivityObservation.createMany({
    data: Array.from({ length: 3_600 }, (_, index) => ({
      githubId: TWELFTH.githubId,
      year: 2097 - Math.floor(index / 365),
      visibility: ActivityVisibility.PUBLIC,
      commitCount: index,
      observedAt: new Date(START.getTime() - (index + 1) * DAY_MS),
    })),
  });
  rawQuery.mockClear();
  countQuery.mockClear();
  await repository.findRankedPage({}, { offset: 0, limit: 10 }, NOW);
  const tenTimes = {
    raw: rawQuery.mock.calls.length,
    count: countQuery.mock.calls.length,
  };

  expect(oneTimes).toEqual({ raw: 1, count: 1 });
  expect(tenTimes).toEqual(oneTimes);
  rawQuery.mockRestore();
  countQuery.mockRestore();
});
