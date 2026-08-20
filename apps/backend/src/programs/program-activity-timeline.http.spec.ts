import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { SessionGuard } from '../auth/session.guard';
import { OriginGuard } from '../auth/origin.guard';
import { ProgramActivityRepository } from './repository/program-activity.repository';
import { ProgramActivityService } from './service/program-activity.service';
import { ProgramCreationService } from './service/program-creation.service';
import { ProgramLifecycleService } from './service/program-lifecycle.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './controller/programs.controller';
import { ProgramsRepository } from './repository/programs.repository';
import { ProgramsService } from './service/programs.service';
import { ProgramViewerService } from './service/program-viewer.service';
import { StudentDashboardService } from './service/student-dashboard.service';

let application: INestApplication | undefined;
let baseUrl = '';

const applications = [
  {
    teamId: 'team-1',
    applicant: { githubId: 11n },
    team: {
      leader: { githubId: 11n },
      members: [{ user: { githubId: 11n } }],
    },
    program: {
      id: 'program-1',
      name: 'Capstone 2026',
      applicationStartAt: new Date('2026-03-01T00:00:00.000Z'),
    },
    repository: { githubRepositoryId: 101n },
  },
] as const;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramsController, StudentDashboardController],
    providers: [
      ProgramActivityService,
      { provide: StudentDashboardService, useValue: {} },
      { provide: ProgramCreationService, useValue: {} },
      { provide: ProgramsService, useValue: {} },
      // #875 — ProgramsController가 DELETE :id 라우트에서 새로 쓰는 의존성.
      // 이 스펙은 그 라우트를 부르지 않으므로 실제 구현은 필요 없다.
      { provide: ProgramLifecycleService, useValue: { delete: jest.fn() } },
      {
        provide: ProgramViewerService,
        useValue: {
          fromGithubId: jest.fn().mockResolvedValue({
            githubId: 11n,
            userId: 'student-1',
            role: Role.STUDENT,
          }),
        },
      },
      {
        provide: ProgramsRepository,
        useValue: {
          findStudentActivityApplications: jest
            .fn()
            .mockResolvedValue(applications),
        },
      },
      {
        provide: AuthConfig,
        useValue: { sessionSecret: new Uint8Array(32), useSecureCookies: true },
      },
      {
        provide: ProgramActivityRepository,
        useValue: {
          findRepositoryActivity: jest.fn().mockResolvedValue([
            {
              repositoryId: 101n,
              dataAsOf: new Date('2026-07-04T00:00:00.000Z'),
              commitDates: [
                new Date('2026-07-02T00:00:00.000Z'),
                new Date('2026-07-02T01:00:00.000Z'),
              ],
              pullRequestDates: [new Date('2026-07-03T00:00:00.000Z')],
              releaseDates: [new Date('2026-07-04T00:00:00.000Z')],
            },
          ]),
        } satisfies Pick<ProgramActivityRepository, 'findRepositoryActivity'>,
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

afterAll(async () => {
  await application?.close();
});

it.each([
  ['MONTH', '2026-07'],
  ['YEAR', '2026'],
] as const)(
  'serves the current student timeline over HTTP for %s',
  async (granularity, period) => {
    const response = await fetch(
      `${baseUrl}/api/v1/dashboard/student/activity-timeline?granularity=${granularity}`,
    );

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      programs: [{ programId: 'program-1', applicationMode: 'TEAM' }],
      series: {
        granularity,
        points: [
          {
            period,
            commitCount: 2,
            pullRequestCount: 1,
            releaseCount: 1,
            total: 4,
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain('starCount');
  },
);

it('rejects an unsupported granularity at the HTTP boundary', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/dashboard/student/activity-timeline?granularity=WEEK`,
  );

  expect(response.status).toBe(400);
});
