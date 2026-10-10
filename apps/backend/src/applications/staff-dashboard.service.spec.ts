import { Test } from '@nestjs/testing';
import { ProgramTrackType } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramActivitySummaryService } from '../programs/service/program-activity-summary.service';
import { SubmissionDashboardSummaryService } from '../submissions/service/submission-dashboard-summary.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import {
  RUNTIME_CONFIG,
  RuntimeConfigModule,
} from '../runtime-config/runtime-config.module';
import { ApplicationsModule } from './applications.module';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import { StaffDashboardService } from './staff-dashboard.service';

describe('StaffDashboardService', () => {
  const syntheticSessionSecret = Buffer.from(
    'synthetic-staff-dashboard-session-secret',
  ).toString('base64url');

  it('composes applications, activity, and submissions by program id', async () => {
    const applicationSummary = jest.fn().mockResolvedValue({
      programs: [
        {
          id: 'program:1',
          name: 'Synthetic program',
          trackType: ProgramTrackType.EXTRACURRICULAR,
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
          teamManagementPath: '/programs/program%3A1/teams',
        },
        {
          id: 'program:2',
          name: 'No data program',
          trackType: ProgramTrackType.CURRICULAR,
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
          teamManagementPath: '/programs/program%3A2/teams',
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

    const summary = await service.summary(4242n);
    expect(applicationSummary).toHaveBeenCalledWith(4242n);

    expect(summary.programs[0]).toEqual({
      id: 'program:1',
      name: 'Synthetic program',
      trackType: ProgramTrackType.EXTRACURRICULAR,
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
      teamManagementPath: '/programs/program%3A1/teams',
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

  it('resolves concrete summary providers from real ApplicationsModule imports', async () => {
    const summarize = jest.fn().mockResolvedValue([]);
    const listByProgram = jest.fn().mockResolvedValue([]);
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
      .overrideProvider(ProgramActivitySummaryService)
      .useValue({ summarize } satisfies Pick<
        ProgramActivitySummaryService,
        'summarize'
      >)
      .overrideProvider(SubmissionDashboardSummaryService)
      .useValue({ listByProgram } satisfies Pick<
        SubmissionDashboardSummaryService,
        'listByProgram'
      >)
      .overrideProvider(PrismaService)
      .useValue({});

    const compiled = await moduleRef.compile();

    expect(compiled.get(StaffDashboardService)).toBeInstanceOf(
      StaffDashboardService,
    );
    await expect(
      compiled.get(ProgramActivitySummaryService).summarize(['program:1']),
    ).resolves.toEqual([]);
    await expect(
      compiled
        .get(SubmissionDashboardSummaryService)
        .listByProgram(['program:1']),
    ).resolves.toEqual([]);
    expect(summarize).toHaveBeenCalledWith(['program:1']);
    expect(listByProgram).toHaveBeenCalledWith(['program:1']);
    await compiled.close();
  });

  it('권한이 거부되면 활동·제출 요약을 조회하지 않는다', async () => {
    const error = new DomainException(
      APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY],
    );
    const applicationSummary = jest.fn().mockRejectedValue(error);
    const summarize = jest.fn();
    const listByProgram = jest.fn();
    const service = new StaffDashboardService(
      { staffSummary: applicationSummary },
      { summarize },
      { listByProgram },
    );

    await expect(service.summary(4242n)).rejects.toBe(error);
    expect(applicationSummary).toHaveBeenCalledWith(4242n);
    expect(summarize).not.toHaveBeenCalled();
    expect(listByProgram).not.toHaveBeenCalled();
  });
});
