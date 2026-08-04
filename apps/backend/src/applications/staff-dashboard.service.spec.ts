import { Test } from '@nestjs/testing';
import { ProgramCategory } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import {
  RUNTIME_CONFIG,
  RuntimeConfigModule,
} from '../runtime-config/runtime-config.module';
import { ApplicationsModule } from './applications.module';
import { StaffDashboardService } from './staff-dashboard.service';

describe('StaffDashboardService', () => {
  const syntheticSessionSecret = Buffer.from(
    'synthetic-staff-dashboard-session-secret',
  ).toString('base64url');

  it('composes applications, activity, and submissions by program id', async () => {
    // Given
    const applicationSummary = jest.fn().mockResolvedValue({
      programs: [
        {
          id: 'program:1',
          name: 'Synthetic program',
          category: ProgramCategory.BASIC,
          applicationPeriod: {
            startsAt: new Date('2026-07-01T00:00:00.000Z'),
            endsAt: new Date('2026-07-31T23:59:59.000Z'),
          },
          applications: {
            total: 4,
            submitted: 2,
            approved: 1,
            rejected: 1,
          },
          applicantsPath: '/programs/program%3A1/applicants',
        },
        {
          id: 'program:2',
          name: 'No data program',
          category: ProgramCategory.CAPSTONE,
          applicationPeriod: {
            startsAt: new Date('2026-08-01T00:00:00.000Z'),
            endsAt: new Date('2026-08-31T23:59:59.000Z'),
          },
          applications: {
            total: 0,
            submitted: 0,
            approved: 0,
            rejected: 0,
          },
          applicantsPath: '/programs/program%3A2/applicants',
        },
      ],
    });
    const activitySummary = jest.fn().mockResolvedValue([
      {
        programId: 'program:1',
        repositoryCount: 2,
        commitCount: 5,
        pullRequestCount: 3,
        releaseCount: 1,
        lastActivityAt: '2026-07-20T00:00:00.000Z',
        dataAsOf: '2026-07-21T00:00:00.000Z',
        githubRepositoryId: 123n,
      },
    ]);
    const submissionSummary = jest.fn().mockResolvedValue([
      {
        programId: 'program:1',
        approvedApplications: 1,
        milestones: 2,
        total: 2,
        notSubmitted: 1,
        submitted: 1,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    ]);
    const service = new StaffDashboardService(
      { staffSummary: applicationSummary },
      { summarize: activitySummary },
      { listByProgram: submissionSummary },
    );

    // When
    const summary = await service.summary();

    // Then
    expect(summary.programs[0]).toEqual({
      id: 'program:1',
      name: 'Synthetic program',
      category: ProgramCategory.BASIC,
      applicationPeriod: {
        startsAt: new Date('2026-07-01T00:00:00.000Z'),
        endsAt: new Date('2026-07-31T23:59:59.000Z'),
      },
      applications: {
        total: 4,
        submitted: 2,
        pendingApproval: 2,
        approved: 1,
        rejected: 1,
      },
      applicantsPath: '/programs/program%3A1/applicants',
      activity: {
        repositories: 2,
        commits: 5,
        pullRequests: 3,
        releases: 1,
        lastActivityAt: '2026-07-20T00:00:00.000Z',
        dataAsOf: '2026-07-21T00:00:00.000Z',
      },
      submissions: {
        approvedApplications: 1,
        milestones: 2,
        total: 2,
        notSubmitted: 1,
        submitted: 1,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    });
    expect(summary.programs[1]?.activity.dataAsOf).toBeNull();
    expect(summary.programs[1]?.submissions.total).toBe(0);
    expect(activitySummary).toHaveBeenCalledWith(['program:1', 'program:2']);
    expect(submissionSummary).toHaveBeenCalledWith(['program:1', 'program:2']);
    expect(JSON.stringify(summary)).not.toContain('githubRepositoryId');
  });

  it('compiles from real ApplicationsModule providers', async () => {
    // Given
    const moduleRef = Test.createTestingModule({
      imports: [RuntimeConfigModule, PrismaModule, ApplicationsModule],
    })
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(
        loadRuntimeConfig({
          SESSION_SECRET: syntheticSessionSecret,
          FRONTEND_URL: 'http://localhost:3000',
          GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
          GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
          GITHUB_OAUTH_CALLBACK_URL:
            'http://localhost:3000/api/v1/auth/github/callback',
          TEAM_JOIN_CODE_SECRET: 'synthetic-staff-dashboard-secret',
          MAIL_MODE: 'dry-run',
        }),
      )
      .overrideProvider(PrismaService)
      .useValue({});

    // When
    const compiled = await moduleRef.compile();

    // Then
    expect(compiled.get(StaffDashboardService)).toBeInstanceOf(
      StaffDashboardService,
    );
    await compiled.close();
  });
});
