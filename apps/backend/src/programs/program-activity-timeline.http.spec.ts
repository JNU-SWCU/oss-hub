import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { SessionGuard } from '../auth/session.guard';
import { OriginGuard } from '../auth/origin.guard';
import { ProgramActivityService } from './program-activity.service';
import { ProgramCreationService } from './program-creation.service';
import {
  ProgramsController,
  StudentDashboardController,
} from './programs.controller';
import { ProgramsRepository } from './programs.repository';
import { ProgramsService } from './programs.service';
import { ProgramViewerService } from './program-viewer.service';

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
          findStudentOwnedRepositoryIds: jest
            .fn()
            .mockResolvedValue([{ githubRepositoryId: 101n }]),
          async *findStudentTimelineObservationBatches() {
            await Promise.resolve();
            yield [
              {
                id: 'row-1',
                sourceId: 'push-1',
                payload: {
                  type: 'PushEvent',
                  repo: { id: 101 },
                  payload: { size: 2 },
                  created_at: '2026-07-02T00:00:00.000Z',
                },
                run: { targetGithubId: 11n },
              },
            ];
          },
        },
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
    await expect(response.json()).resolves.toMatchObject({
      programs: [{ programId: 'program-1', applicationMode: 'PERSONAL' }],
      series: {
        granularity,
        points: [
          { period, commitCount: 2, prCount: 0, starCount: 0, total: 2 },
        ],
      },
    });
  },
);

it('rejects an unsupported granularity at the HTTP boundary', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/dashboard/student/activity-timeline?granularity=WEEK`,
  );

  expect(response.status).toBe(400);
});
