import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import type { Request } from 'express';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { attachAnonymousAuth } from '../../auth/controller/http-auth';
import { configureHttpApp } from '../../common/controller/configure-http-app';
import { PrismaService } from '../../prisma/prisma.service';
import { RankingController } from '../controller/ranking.controller';
import { RankingService } from '../service/ranking.service';
import { RankingRepository } from './ranking.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new RankingRepository(prisma);

const PREFIX = 'synthetic-ranking-timeline';
const YEAR = 2099;
const OBSERVED_AT = new Date('2099-04-01T00:00:00.000Z');

interface SyntheticStudent {
  readonly key: string;
  readonly githubId: bigint;
  readonly studentId: string;
  readonly yearCommitCount: number;
}

const student = (index: number, yearCommitCount: number): SyntheticStudent => ({
  key: `u${String(index)}`,
  githubId: 8_962_000_000_000n + BigInt(index),
  studentId: `20990${String(index)}`,
  yearCommitCount,
});

const STUDENTS: readonly SyntheticStudent[] = [100, 80, 60, 40].map(
  (yearCommitCount, index) => student(index + 1, yearCommitCount),
);

const IDLE_STUDENT: SyntheticStudent = student(5, 0);

const ALL_STUDENTS: readonly SyntheticStudent[] = [...STUDENTS, IDLE_STUDENT];

const GITHUB_IDS = ALL_STUDENTS.map((student) => student.githubId);

function login(student: SyntheticStudent): string {
  return `${PREFIX}-${student.key}`;
}

interface SyntheticSnapshot {
  readonly student: SyntheticStudent;
  readonly date: string;
  readonly commitCount: number;
}

const SNAPSHOTS: readonly SyntheticSnapshot[] = [
  ...STUDENTS.map((student, index) => ({
    student,
    date: '2099-01-31',
    commitCount: (index + 1) * 10,
  })),
  {
    student: STUDENTS[0] as SyntheticStudent,
    date: '2099-02-15',
    commitCount: 5,
  },
  ...STUDENTS.map((student, index) => ({
    student,
    date: '2099-02-28',
    commitCount: index === 0 ? 50 : index,
  })),
  ...STUDENTS.map((student, index) => ({
    student,
    date: '2099-03-31',
    commitCount: 60 + index,
  })),
  ...['2099-01-31', '2099-02-28', '2099-03-31'].map((date) => ({
    student: IDLE_STUDENT,
    date,
    commitCount: 0,
  })),
];

async function seed(): Promise<void> {
  for (const student of ALL_STUDENTS) {
    const department = `${PREFIX}-학부`;
    await prisma.user.create({
      data: {
        id: `${PREFIX}-${student.key}`,
        githubId: student.githubId,
        nickname: login(student),
        accountStatus: AccountStatus.ACTIVE,
        selectedMemberKind: MemberKind.STUDENT,
        profile: {
          create: {
            name: `합성 ${student.key}`,
            studentId: student.studentId,
            department,
            memberKind: MemberKind.STUDENT,
            affiliationKind: AffiliationKind.DEPARTMENT,
            affiliationName: department,
          },
        },
      },
    });
    await prisma.githubUserActivityHistory.create({
      data: {
        githubId: student.githubId,
        githubLogin: login(student),
        year: YEAR,
        commitCount: student.yearCommitCount,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        observedAt: OBSERVED_AT,
      },
    });
  }

  for (const row of SNAPSHOTS) {
    await prisma.githubUserActivitySnapshot.create({
      data: {
        githubId: row.student.githubId,
        snapshotDate: new Date(`${row.date}T00:00:00.000Z`),
        year: YEAR,
        githubLogin: login(row.student),
        commitCount: row.commitCount,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        observedAt: new Date(`${row.date}T01:00:00.000Z`),
      },
    });
  }
}

async function purge(): Promise<void> {
  await prisma.githubUserActivitySnapshot.deleteMany({
    where: { githubId: { in: GITHUB_IDS } },
  });
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: { in: GITHUB_IDS } },
  });
  await prisma.user.deleteMany({ where: { githubId: { in: GITHUB_IDS } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await purge();
  await seed();
});

afterAll(async () => {
  await purge();
  await prisma.$disconnect();
});

describe('RankingRepository.findMonthlySnapshots (실 Postgres)', () => {
  it('사용자-월 당 한 행만, 그 달의 가장 늦은 스냅샷으로, 같은 연도만 돌려준다', async () => {
    const rows = (await repository.findMonthlySnapshots(YEAR)).filter((row) =>
      GITHUB_IDS.includes(row.githubId),
    );

    expect(rows).toHaveLength(ALL_STUDENTS.length * 3);
    const userMonths = rows.map(
      (row) =>
        `${row.githubId.toString()}:${row.snapshotDate.getUTCMonth() + 1}`,
    );
    expect(new Set(userMonths).size).toBe(userMonths.length);

    const februaryOfFirst = rows.find(
      (row) =>
        row.githubId === STUDENTS[0]?.githubId &&
        row.snapshotDate.getUTCMonth() === 1,
    );
    expect(februaryOfFirst).toMatchObject({
      snapshotDate: new Date('2099-02-28T00:00:00.000Z'),
      commitCount: 50,
    });

    const otherYear = (await repository.findMonthlySnapshots(YEAR + 1)).filter(
      (row) => GITHUB_IDS.includes(row.githubId),
    );
    expect(otherYear).toEqual([]);
  });
});

describe('RankingService.findTimeline (실 Postgres)', () => {
  it('월별 지점·추정 표시·지점별 순위를 실제 스냅샷에서 만들고 0점 학생만 계열에서 뺀다', async () => {
    const service = new RankingService(repository);

    const timeline = await service.findTimeline(YEAR, null);
    const page = await service.findPage(YEAR, 1, 100, null);

    expect(timeline.points).toEqual([
      { date: '2099-01-31' },
      { date: '2099-02-28' },
      { date: '2099-03-31' },
      { date: `${YEAR}-12-31` },
    ]);

    const seeded = timeline.series.filter((series) =>
      series.githubLogin.startsWith(PREFIX),
    );
    expect(seeded.map((series) => series.ranks)).toEqual([
      [4, 1, 4, 1],
      [3, 4, 3, 2],
      [2, 3, 2, 3],
      [1, 2, 1, 4],
    ]);

    const ranked = new Set(timeline.series.map((series) => series.githubLogin));
    expect([...ranked]).not.toContain(login(IDLE_STUDENT));
    expect(page.items.map((item) => item.githubLogin)).toContain(
      login(IDLE_STUDENT),
    );
    expect(
      seeded.map((series) => [series.githubLogin, series.ranks.at(-1)]),
    ).toEqual(
      page.items
        .filter(
          (item) =>
            item.githubLogin.startsWith(PREFIX) && ranked.has(item.githubLogin),
        )
        .map((item) => [item.githubLogin, item.rank]),
    );
  });

  it('기여 합계가 0인 학생 자신이 보면 자기 계열은 표 순위로 남는다', async () => {
    const service = new RankingService(repository);

    const timeline = await service.findTimeline(YEAR, IDLE_STUDENT.githubId);
    const page = await service.findPage(YEAR, 1, 100, IDLE_STUDENT.githubId);

    expect(timeline.viewerClass).toBe('member');
    expect(timeline.viewerGithubLogin).toBe(login(IDLE_STUDENT));
    const idleSeries = timeline.series.find(
      (series) => series.githubLogin === login(IDLE_STUDENT),
    );
    expect(typeof idleSeries?.ranks.at(-1)).toBe('number');
    expect(idleSeries?.ranks.at(-1)).toBe(
      page.items.find((item) => item.githubLogin === login(IDLE_STUDENT))?.rank,
    );
  });
});

describe('GET /api/v1/ranking/timeline (실 Postgres · 익명 HTTP)', () => {
  let application: INestApplication | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RankingController],
      providers: [
        RankingService,
        { provide: RankingRepository, useValue: repository },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate(context: ExecutionContext): boolean {
              attachAnonymousAuth(
                context.switchToHttp().getRequest<Request>(),
                false,
              );
              return true;
            },
          },
        },
      ],
    }).compile();

    application = moduleRef.createNestApplication();
    configureHttpApp(application);
    await application.listen(0, '127.0.0.1');
    baseUrl = await application.getUrl();
  });

  afterAll(async () => {
    await application?.close();
  });

  it('익명 호출도 DB 스냅샷에서 만든 지점과 totals 를 no-store 로 싣는다', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/ranking/timeline?year=${YEAR}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = (await response.json()) as {
      points: readonly { date: string }[];
      series: readonly {
        githubLogin: string;
        totals: readonly unknown[];
      }[];
    };
    expect(body.points.map((point) => point.date)).toEqual([
      '2099-01-31',
      '2099-02-28',
      '2099-03-31',
      '2099-12-31',
    ]);
    expect(
      body.series.filter((series) => series.githubLogin.startsWith(PREFIX)),
    ).toHaveLength(STUDENTS.length);
    for (const series of body.series) {
      expect(series.totals).toHaveLength(body.points.length);
    }
  });

  it('year=all 은 400 이다', async () => {
    const response = await fetch(`${baseUrl}/api/v1/ranking/timeline?year=all`);

    expect(response.status).toBe(400);
  });
});
