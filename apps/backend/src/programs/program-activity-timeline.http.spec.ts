import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { SessionGuard } from '../auth/session.guard';
import { OriginGuard } from '../auth/origin.guard';
import {
  COLLECTION_READ_PORT,
  type CollectionReadPort,
} from '../collection/collection-read.port';
import { ProgramActivityService } from './program-activity.service';
import { ProgramCreationService } from './program-creation.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './programs.controller';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';
import { ProgramViewerService } from './program-viewer.service';
import { StudentDashboardService } from './student-dashboard.service';

let application: INestApplication | undefined;
let baseUrl = '';

const applications = [
  {
    teamId: null,
    applicant: { githubId: 11n },
    team: null,
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
        provide: COLLECTION_READ_PORT,
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
        } satisfies Pick<CollectionReadPort, 'findRepositoryActivity'>,
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
      programs: [{ programId: 'program-1', applicationMode: 'PERSONAL' }],
      series: {
        granularity,
        points: [
          {
            period,
            commitCount: 2,
            prCount: 1,
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
