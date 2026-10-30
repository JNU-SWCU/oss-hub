import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AccountStatus, MemberKind } from '@prisma/client';
import type { Request } from 'express';
import {
  attachAnonymousAuth,
  attachAuthenticatedPrincipal,
} from '../../auth/controller/http-auth';
import { configureHttpApp } from '../../common/controller/configure-http-app';
import {
  calendarDateInAsiaSeoul,
  rankingYearInAsiaSeoul,
} from '../domain/ranking-event';
import {
  RankingRepository,
  type RankingMetricRow,
  type RankingSnapshotRow,
} from '../repository/ranking.repository';
import { RankingService } from '../service/ranking.service';
import { RankingController } from './ranking.controller';

const NOW = new Date();
const YEAR = rankingYearInAsiaSeoul(NOW);
const TODAY = calendarDateInAsiaSeoul(NOW);
const CURRENT_MONTH = Number(TODAY.slice(5, 7));

const MEMBER_GITHUB_ID = 7_742_000_000_001n;
const MEMBER_HEADER = 'x-synthetic-session-github-id';

function metric(
  githubId: bigint,
  githubLogin: string,
  commitCount: number,
): RankingMetricRow {
  return {
    githubId,
    githubLogin,
    department: '합성학과',
    commitCount,
    pullRequestCount: 0,
    issueCount: 0,
    repositoryCount: 0,
    starCount: 0,
  };
}

const METRICS: readonly RankingMetricRow[] = [
  metric(MEMBER_GITHUB_ID, 'synthetic-alpha', 300),
  metric(7_742_000_000_002n, 'synthetic-bravo', 200),
  metric(7_742_000_000_003n, 'synthetic-carol', 100),
];

const SNAPSHOTS: readonly RankingSnapshotRow[] = METRICS.flatMap(
  (row, index) =>
    Array.from({ length: CURRENT_MONTH - 1 }, (_unused, monthIndex) => ({
      githubId: row.githubId,
      snapshotDate: new Date(
        `${YEAR}-${String(monthIndex + 1).padStart(2, '0')}-15T00:00:00.000Z`,
      ),
      commitCount: (monthIndex + 1) * (index + 1),
      pullRequestCount: 0,
      issueCount: 0,
      repositoryCount: 0,
      starCount: 0,
      starEstimated: monthIndex === 0,
    })),
);

const repository = {
  findMetrics: () => Promise.resolve(METRICS),
  findMonthlySnapshots: () => Promise.resolve(SNAPSHOTS),
  findDataAsOf: () => Promise.resolve(NOW),
  findViewerClass: (githubId: bigint | null) =>
    Promise.resolve(githubId === null ? 'public' : 'member'),
  findViewerGithubLogin: () => Promise.resolve('synthetic-alpha'),
} as unknown as RankingRepository;

const sessionAttachingGuard = {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const githubId = request.headers[MEMBER_HEADER];
    if (typeof githubId !== 'string') {
      attachAnonymousAuth(request, false);
      return true;
    }
    attachAuthenticatedPrincipal(
      request,
      {
        id: 'synthetic-timeline-viewer',
        githubId: BigInt(githubId),
        nickname: 'synthetic-alpha',
        name: null,
        avatarUrl: null,
        accountStatus: AccountStatus.ACTIVE,
        sessionVersion: 0,
        memberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
        isProfileComplete: true,
      },
      BigInt(githubId),
    );
    return true;
  },
};

let application: INestApplication | undefined;
let baseUrl = '';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [RankingController],
    providers: [
      RankingService,
      { provide: RankingRepository, useValue: repository },
      { provide: APP_GUARD, useValue: sessionAttachingGuard },
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

describe('GET /api/v1/ranking/timeline (HTTP)', () => {
  it('익명 호출은 지점을 최소 하나 싣고 totals 를 전혀 싣지 않는다', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/ranking/timeline?year=${YEAR}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBeNull();

    const payload = await response.text();
    expect(payload).not.toContain('totals');
    const body: unknown = JSON.parse(payload);
    expect(body).toMatchObject({
      year: YEAR,
      viewerClass: 'public',
      viewerGithubLogin: null,
      dataAsOf: NOW.toISOString(),
    });

    const timeline = body as {
      points: readonly { date: string; starEstimated: boolean }[];
      series: readonly { githubLogin: string; ranks: readonly unknown[] }[];
    };
    expect(timeline.points.length).toBeGreaterThanOrEqual(1);
    expect(timeline.points).toHaveLength(CURRENT_MONTH);
    expect(timeline.points.at(-1)).toEqual({
      date: TODAY,
      starEstimated: false,
    });
    expect(timeline.series.map((series) => series.githubLogin)).toEqual([
      'synthetic-alpha',
      'synthetic-bravo',
      'synthetic-carol',
    ]);
    for (const series of timeline.series) {
      expect(Object.keys(series).sort()).toEqual(['githubLogin', 'ranks']);
      expect(series.ranks).toHaveLength(timeline.points.length);
    }
  });

  it('세션이 있는 열람자는 totals 와 private 캐시 헤더를 받는다', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/ranking/timeline?year=${YEAR}`,
      { headers: { [MEMBER_HEADER]: MEMBER_GITHUB_ID.toString() } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');

    const body = (await response.json()) as {
      viewerGithubLogin: string | null;
      series: readonly { totals?: readonly unknown[] }[];
    };
    expect(body.viewerGithubLogin).toBe('synthetic-alpha');
    for (const series of body.series) {
      expect(series.totals).toHaveLength(CURRENT_MONTH);
    }
  });

  it.each(['all', 'abc', '1999', '20261'])(
    'year=%s 는 400 으로 막는다',
    async (year) => {
      const response = await fetch(
        `${baseUrl}/api/v1/ranking/timeline?year=${year}`,
      );

      expect(response.status).toBe(400);
    },
  );

  it('2026 이전 연도는 200 과 빈 배열이다', async () => {
    const response = await fetch(`${baseUrl}/api/v1/ranking/timeline?year=2025`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      year: 2025,
      points: [],
      series: [],
      dataAsOf: null,
    });
  });
});
