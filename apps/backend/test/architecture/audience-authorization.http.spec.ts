import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, MemberKind } from '@prisma/client';
import { AuditLogController } from '../../src/admin/audit-log.controller';
import { AuditLogRepository } from '../../src/platform/audit-log.repository';
import { AuditLogService } from '../../src/platform/audit-log.service';
import { StaffDashboardController } from '../../src/staff/staff-dashboard.controller';
import { ApplicationsRepository } from '../../src/programs/applications.repository';
import { StaffInsightsRepository } from '../../src/staff/staff-insights.repository';
import { ApplicationJoinCodeService } from '../../src/programs/application-preparations.service';
import { ApplicationsService } from '../../src/programs/applications.service';
import { StaffDashboardService } from '../../src/staff/staff-dashboard.service';
import { StaffInsightsService } from '../../src/staff/staff-insights.service';
import { AuthConfig } from '../../src/auth/auth.config';
import { OriginGuard } from '../../src/auth/origin.guard';
import { SessionGuard } from '../../src/auth/session.guard';
import { sessionCookieName } from '../../src/auth/cookies.policy';
import { issueSessionToken } from '../../src/auth/auth.policy';
import { AuthService } from '../../src/auth/auth.service';
import { configureHttpApp } from '../../src/platform/configure-http-app.config';
import { MyRepositoriesController } from '../../src/student/my-repositories.controller';
import { GithubOperationsConfig } from '../../src/github/github-operations.config';
import { RepositoriesRepository } from '../../src/github/repositories.repository';
import { RepositoriesReadService } from '../../src/github/repositories-read.service';
import { MilestoneDocumentFeedbackRepository } from '../../src/student/milestone-document-feedback.repository';
import {
  MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
  MilestoneDocumentFeedbackService,
} from '../../src/student/milestone-document-feedback.service';
import { PrismaService } from '../../src/platform/prisma.service';
import { StudentDashboardController } from '../../src/student/student-dashboard.controller';
import {
  ProgramActivityRepository,
  ProgramActivitySummaryRepository,
} from '../../src/programs/program-activity.repository';
import { ProgramsRepository } from '../../src/programs/programs.repository';
import { StudentDashboardRepository } from '../../src/student/student-dashboard.repository';
import { ProgramActivityService } from '../../src/programs/program-activity.service';
import { ProgramActivitySummaryService } from '../../src/programs/program-activity-summary.service';
import { ProgramViewerService } from '../../src/programs/program-viewer.service';
import { StudentDashboardService } from '../../src/student/student-dashboard.service';
import { loadRuntimeConfig } from '../../src/platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../../src/platform/runtime-config-instance.config';
import { SubmissionDashboardSummaryRepository } from '../../src/programs/submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from '../../src/programs/submission-dashboard-summary.service';
import { SystemStatusController } from '../../src/admin/system-status.controller';
import { SystemStatusRepository } from '../../src/admin/system-status.repository';
import {
  SYSTEM_STATUS_CLOCK,
  SystemStatusService,
} from '../../src/admin/system-status.service';
import { UserAccessController } from '../../src/admin/user-access.controller';
import { AccessRequestsController } from '../../src/staff/access-requests.controller';
import { AdminAccessRepository } from '../../src/users/admin-access.repository';
import { AdminProfileRepository } from '../../src/users/admin-profile.repository';
import {
  IndependentAuthorityRepository,
  UsersAuthorityRepository,
} from '../../src/users/independent-authority.repository';
import { MemberKindRepository } from '../../src/users/member-kind.repository';
import { AdminAccessService } from '../../src/users/admin-access.service';
import { AdminProfileService } from '../../src/users/admin-profile.service';
import { UsersAuthorityService } from '../../src/users/authority.service';
import { IndependentAuthorityService } from '../../src/users/independent-authority.service';
import { MemberKindService } from '../../src/users/member-kind.service';

type Actor = {
  readonly label: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus | null;
  readonly hasCookie: boolean;
};

const roles: readonly Actor[] = [
  ['ADMIN', true, true, AccountStatus.ACTIVE, true],
  ['ADMIN without staff', false, true, AccountStatus.ACTIVE, true],
  ['STAFF', true, false, AccountStatus.ACTIVE, true],
  ['STUDENT', false, false, AccountStatus.ACTIVE, true],
  ['inactive STAFF', true, false, AccountStatus.DEACTIVATED, true],
  ['inactive ADMIN', true, true, AccountStatus.DEACTIVATED, true],
  ['missing user', false, false, null, true],
  ['anonymous', false, false, null, false],
].map(
  ([label, hasStaffAccess, hasAdminAccess, accountStatus, hasCookie]) =>
    ({
      label,
      hasStaffAccess,
      hasAdminAccess,
      accountStatus,
      hasCookie,
    }) as Actor,
);

type Statuses = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

type RouteCase = {
  readonly method: 'GET' | 'PATCH';
  readonly path: string;
  readonly body?: Record<string, unknown>;
  readonly statuses: Statuses;
};

const accessPatch = {
  expectedRole: 'STUDENT',
  desiredRole: 'STAFF',
  expectedAccountStatus: 'ACTIVE',
  desiredAccountStatus: 'ACTIVE',
  expectedPendingRequest: null,
};

const routes: readonly RouteCase[] = [
  {
    method: 'GET',
    path: 'dashboard/student',
    statuses: [200, 200, 200, 200, 200, 200, 200, 401],
  },
  {
    method: 'GET',
    path: 'dashboard/student/activity-timeline',
    statuses: [403, 403, 403, 200, 403, 403, 403, 401],
  },
  {
    method: 'GET',
    path: 'dashboard/student/feedback',
    statuses: [200, 200, 200, 200, 200, 200, 200, 401],
  },
  {
    method: 'GET',
    path: 'repositories/me',
    statuses: [200, 200, 200, 200, 200, 200, 200, 401],
  },
  {
    method: 'GET',
    path: 'dashboard/staff/summary',
    statuses: [200, 200, 200, 403, 403, 403, 403, 401],
  },
  {
    method: 'GET',
    path: 'dashboard/staff/insights',
    statuses: [200, 200, 200, 403, 403, 403, 403, 401],
  },
  {
    method: 'GET',
    path: 'users/access',
    statuses: [200, 200, 403, 403, 401, 401, 401, 401],
  },
  {
    method: 'GET',
    path: 'users/access/requests',
    statuses: [200, 200, 200, 403, 401, 401, 401, 401],
  },
  {
    method: 'GET',
    path: 'users/access/facets',
    statuses: [200, 200, 403, 403, 401, 401, 401, 401],
  },
  {
    method: 'GET',
    path: 'users/user-1/access',
    statuses: [404, 404, 404, 403, 401, 401, 401, 401],
  },
  {
    method: 'GET',
    path: 'users/user-1/access/history',
    statuses: [404, 404, 404, 403, 401, 401, 401, 401],
  },
  {
    method: 'PATCH',
    path: 'users/user-1/access',
    body: accessPatch,
    statuses: [404, 404, 403, 403, 401, 401, 401, 401],
  },
  {
    method: 'PATCH',
    path: 'users/user-1/profile',
    body: { name: '홍길동' },
    statuses: [404, 404, 403, 403, 401, 401, 401, 401],
  },
  {
    method: 'PATCH',
    path: 'users/user-1/admin-access',
    body: { command: 'GRANT_ADMIN_ACCESS' },
    statuses: [404, 404, 403, 403, 401, 401, 401, 401],
  },
  {
    method: 'PATCH',
    path: 'users/user-1/member-kind',
    body: {
      memberKind: 'STAFF',
      expectedMemberKind: 'STUDENT',
      expectedHasStaffAccess: false,
    },
    statuses: [404, 404, 403, 403, 401, 401, 401, 401],
  },
  {
    method: 'GET',
    path: 'audit-logs',
    statuses: [200, 200, 403, 403, 403, 403, 403, 401],
  },
  {
    method: 'GET',
    path: 'system-status',
    statuses: [200, 200, 403, 403, 403, 403, 403, 401],
  },
];

describe('Audience authorization HTTP characterization', () => {
  let app: INestApplication;
  let baseUrl: string;
  let cookie: string;
  let actor!: Actor;

  const actorRow = () =>
    actor.accountStatus === null
      ? null
      : {
          id: 'synthetic-actor',
          githubId: 4242n,
          name: '관리자',
          githubLogin: 'synthetic-actor',
          role: 'ADMIN',
          memberKind: MemberKind.STAFF,
          hasStaffAccess: actor.hasStaffAccess,
          hasAdminAccess: actor.hasAdminAccess,
          accountStatus: actor.accountStatus,
        };
  const findActor = () => Promise.resolve(actorRow());
  const facets = { roles: [], accountStatuses: [], pendingRequests: [] };
  const emptyPage = { items: [], page: 1, limit: 20, total: 0, facets };
  const transactionStore = {
    auditLogWriter: {},
    lockActiveAdmins: () => Promise.resolve(1),
    findActorByGithubId: findActor,
    findActor,
    findUserForUpdate: () => Promise.resolve(null),
    findTargetForUpdate: () => Promise.resolve(null),
    findTarget: () => Promise.resolve(null),
  };
  const withTransaction = (operation: (store: unknown) => unknown) =>
    Promise.resolve(operation(transactionStore));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        StudentDashboardController,
        MyRepositoriesController,
        StaffDashboardController,
        AccessRequestsController,
        UserAccessController,
        AuditLogController,
        SystemStatusController,
      ],
      providers: [
        SessionGuard,
        OriginGuard,
        UsersAuthorityService,
        UsersAuthorityRepository,
        StudentDashboardService,
        ProgramActivityService,
        ProgramViewerService,
        MilestoneDocumentFeedbackService,
        RepositoriesReadService,
        StaffDashboardService,
        StaffInsightsService,
        ApplicationsService,
        ApplicationJoinCodeService,
        ProgramActivitySummaryService,
        SubmissionDashboardSummaryService,
        AdminAccessService,
        AdminProfileService,
        IndependentAuthorityService,
        MemberKindService,
        AuditLogService,
        SystemStatusService,
        {
          provide: AuthService,
          useValue: {
            getMe: () => ({ id: 'synthetic-actor', sessionVersion: 0 }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: () =>
                actor.accountStatus === null
                  ? null
                  : {
                      id: 'synthetic-actor',
                      hasStaffAccess: actor.hasStaffAccess,
                      hasAdminAccess: actor.hasAdminAccess,
                      accountStatus: actor.accountStatus,
                    },
            },
          },
        },
        {
          provide: AuthConfig,
          useValue: new AuthConfig(
            loadRuntimeConfig({
              SESSION_SECRET: Buffer.from(
                'synthetic-audience-authorization-secret',
              ).toString('base64url'),
              FRONTEND_URL: 'http://localhost:3000',
              GITHUB_OAUTH_CLIENT_ID: 'synthetic-client',
              GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-secret',
            }),
          ),
        },
        { provide: SYSTEM_STATUS_CLOCK, useValue: () => new Date(0) },
        {
          provide: MILESTONE_DOCUMENT_FEEDBACK_CLOCK,
          useValue: () => new Date(0),
        },
        {
          provide: RUNTIME_CONFIG,
          useValue: loadRuntimeConfig({
            TEAM_JOIN_CODE_SECRET: 'synthetic-join-code-secret',
          }),
        },
        {
          provide: GithubOperationsConfig,
          useValue: { requireOrganization: () => 'synthetic-org' },
        },
        {
          provide: StudentDashboardRepository,
          useValue: {
            findParticipatingApplications: () => Promise.resolve([]),
          },
        },
        {
          provide: RepositoriesRepository,
          useValue: { listOwnedProvisionJobs: () => Promise.resolve([]) },
        },
        {
          provide: MilestoneDocumentFeedbackRepository,
          useValue: { findRecentForParticipant: () => Promise.resolve([]) },
        },
        {
          provide: ProgramsRepository,
          useValue: {
            findStudentApplication: () => Promise.resolve(null),
            findStudentActivityApplications: () => Promise.resolve([]),
            findViewer: () =>
              Promise.resolve(
                actor.accountStatus === null
                  ? null
                  : {
                      id: 'synthetic-actor',
                      accountStatus: actor.accountStatus,
                      hasStaffAccess: actor.hasStaffAccess,
                      hasAdminAccess: actor.hasAdminAccess,
                      profile: {
                        memberKind:
                          actor.hasStaffAccess || actor.hasAdminAccess
                            ? MemberKind.STAFF
                            : MemberKind.STUDENT,
                      },
                      staffAccessRequests: [],
                    },
              ),
          },
        },
        {
          provide: ProgramActivityRepository,
          useValue: { findRepositoryActivity: () => Promise.resolve([]) },
        },
        {
          provide: ProgramActivitySummaryRepository,
          useValue: { findRepositoryLinks: () => Promise.resolve([]) },
        },
        {
          provide: SubmissionDashboardSummaryRepository,
          useValue: {
            listRecords: () =>
              Promise.resolve({
                applications: [],
                milestones: [],
                submissions: [],
                milestoneDocuments: [],
                documentSubmissions: [],
              }),
          },
        },
        {
          provide: ApplicationsRepository,
          useValue: {
            listStaffDashboardSummary: () => Promise.resolve({ programs: [] }),
          },
        },
        {
          provide: StaffInsightsRepository,
          useValue: {
            listStudents: () => Promise.resolve([]),
            listApprovedParticipations: () => Promise.resolve([]),
            listActivityTotals: () => Promise.resolve([]),
            listActivityYears: () => Promise.resolve([]),
            findActivityDataAsOf: () => Promise.resolve(null),
          },
        },
        {
          provide: AdminAccessRepository,
          useValue: {
            withTransaction,
            findActorByGithubId: findActor,
            findById: () => Promise.resolve(null),
            list: () => Promise.resolve(emptyPage),
            facets: () => Promise.resolve(facets),
            listStaffAccessRequestHistory: () => Promise.resolve(emptyPage),
            listLoginHistory: () => Promise.resolve(emptyPage),
          },
        },
        { provide: AdminProfileRepository, useValue: { withTransaction } },
        {
          provide: IndependentAuthorityRepository,
          useValue: { withTransaction },
        },
        { provide: MemberKindRepository, useValue: { withTransaction } },
        {
          provide: AuditLogRepository,
          useValue: {
            findActorByGithubId: findActor,
            list: () => Promise.resolve({ items: [], total: 0 }),
            record: () => Promise.resolve({}),
          },
        },
        {
          provide: SystemStatusRepository,
          useValue: {
            findActor,
            getIncrementalStatusSnapshot: () =>
              Promise.resolve({
                trackedRepositoryCount: 0,
                readyStreamCount: 0,
                backfillingStreamCount: 0,
                partialStreamCount: 0,
                retryPendingStreamCount: 0,
                latestCheckpointAt: null,
                oldestReadyCheckpointAt: null,
                oldestRetryPendingAt: null,
                lastCycleStartedAt: null,
                lastCycleCompletedAt: null,
              }),
            countFinalProvisionFailures: () => Promise.resolve(0),
            getIncrementalStatusStreams: () => Promise.resolve([]),
            getRecentSweepActivity: () => Promise.resolve([]),
            getExternalCollectionStatus: () =>
              Promise.resolve({
                trackedRepositoryCount: 0,
                lastSweep: null,
                cumulativeCommitCount: 0,
                cumulativePullRequestCount: 0,
                cumulativeReleaseCount: 0,
                cumulativeIssueCount: 0,
              }),
          },
        },
      ],
    })
      .useMocker((token) => (token === Function ? undefined : {}))
      .compile();
    const config = module.get(AuthConfig);
    cookie = `${sessionCookieName(config.useSecureCookies)}=${await issueSessionToken(config.sessionSecret, 4242n, 0)}`;
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('covers 17 routes for 8 roles', () => {
    expect(routes).toHaveLength(17);
    expect(roles).toHaveLength(8);
  });

  it.each(
    routes.flatMap((route) =>
      roles.map(
        (role, index) =>
          [role.label, route.method, route.path, role, route, index] as const,
      ),
    ),
  )(
    '%s %s %s preserves status',
    async (_label, _method, _path, role, route, index) => {
      actor = role;
      const response = await fetch(`${baseUrl}/api/v1/${route.path}`, {
        method: route.method,
        headers: {
          origin: 'http://localhost:3000',
          connection: 'close',
          ...(route.body ? { 'content-type': 'application/json' } : {}),
          ...(role.hasCookie ? { cookie } : {}),
        },
        ...(route.body ? { body: JSON.stringify(route.body) } : {}),
      });
      await response.text();
      expect(response.status).toBe(route.statuses[index]);
    },
  );
});
