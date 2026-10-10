import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  AccountStatus,
  ApplicationReviewEventKind,
  ApplicationStatus,
  ProgramLifecycle,
  ProgramTrackType,
  RepositoryConnectionMode,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import { AuthConfig } from '../../auth/auth.config';
import { AuthService } from '../../auth/service/auth.service';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { issueSessionToken } from '../../auth/domain/session-token';
import { sessionCookieName } from '../../auth/domain/cookies';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ProblemDetailFilter } from '../../common/controller/problem-detail.filter';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { ApplicationsController } from './applications.controller';
import type { ApplicationsRepository } from '../repository/applications.repository';
import type {
  ApplicationListItem,
  ApplicationListPage,
  ApplicationReviewHistoryEntry,
  StaffDashboardSummary,
  TeamManagementListPage,
} from '../domain/application-records';
import { ApplicationsService } from '../service/applications.service';
import type { ApplicationDecisionTarget } from '../domain/application-decision';
import { ProgramApplicationsController } from './program-applications.controller';
import { StaffDashboardController } from './staff-dashboard.controller';
import { StaffDashboardService } from '../service/staff-dashboard.service';
import type { StaffInsightsRepository } from '../repository/staff-insights.repository';
import { StaffInsightsService } from '../service/staff-insights.service';

const allowedOrigin = 'http://frontend.test';
const foreignOrigin = 'http://foreign.test';
const sessionSecret = new Uint8Array(32).fill(9);
const APPLICATION_ID = 'synthetic-application';
const PROGRAM_ID = 'synthetic-program';
const UNKNOWN_GITHUB_ID = 9199n;
const SUBMITTED_AT = new Date('2026-08-05T05:32:00.000Z');
const UPDATED_AT = new Date('2026-08-06T01:00:00.000Z');
const decisionPath = `/api/v1/applications/${APPLICATION_ID}`;
const listPath = `/api/v1/programs/${PROGRAM_ID}/applications`;
const summaryPath = '/api/v1/dashboard/staff/summary';
const insightsPath = '/api/v1/dashboard/staff/insights';

interface ActorRow {
  readonly id: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
}

interface Actor {
  readonly label: string;
  readonly githubId: bigint | null;
  readonly row: ActorRow | null;
  readonly allowed: boolean;
}

const actors: readonly Actor[] = [
  { label: 'anonymous', githubId: null, row: null, allowed: false },
  {
    label: 'STUDENT',
    githubId: 9101n,
    row: {
      id: 'cuid-synthetic-student',
      hasStaffAccess: false,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    },
    allowed: false,
  },
  {
    label: 'inactive STAFF',
    githubId: 9102n,
    row: {
      id: 'cuid-synthetic-inactive-staff',
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
    },
    allowed: false,
  },
  {
    label: 'STAFF',
    githubId: 9103n,
    row: {
      id: 'cuid-synthetic-staff',
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.ACTIVE,
    },
    allowed: true,
  },
  {
    label: 'ADMIN',
    githubId: 9104n,
    row: {
      id: 'cuid-synthetic-admin',
      hasStaffAccess: false,
      hasAdminAccess: true,
      accountStatus: AccountStatus.ACTIVE,
    },
    allowed: true,
  },
];

interface ProblemExpectation {
  readonly status: number;
  readonly title: string;
  readonly code: string;
  readonly detail: string;
}

const UNAUTHENTICATED: ProblemExpectation = {
  status: 401,
  title: 'UNAUTHORIZED',
  code: 'AUT_003',
  detail: '로그인이 필요합니다.',
};
const ORIGIN_FORBIDDEN: ProblemExpectation = {
  status: 403,
  title: 'FORBIDDEN',
  code: 'AUT_002',
  detail: '허용되지 않은 Origin의 요청입니다.',
};
const STAFF_ONLY: ProblemExpectation = {
  status: 403,
  title: 'FORBIDDEN',
  code: 'APP_004',
  detail: '승인된 교직원 또는 관리자만 신청을 승인하거나 반려할 수 있습니다.',
};
const STAFF_LIST_ONLY: ProblemExpectation = {
  status: 403,
  title: 'FORBIDDEN',
  code: 'APP_018',
  detail: '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
};
const APPLICATION_NOT_FOUND: ProblemExpectation = {
  status: 404,
  title: 'NOT_FOUND',
  code: 'APP_001',
  detail: '신청을 찾을 수 없습니다.',
};
const PROGRAM_NOT_FOUND: ProblemExpectation = {
  status: 404,
  title: 'NOT_FOUND',
  code: 'APP_009',
  detail: '프로그램을 찾을 수 없습니다.',
};
const INVALID_DECISION_BODY_DETAIL =
  'property isRepositoryPublicationPlanned should not exist';
const INVALID_LIST_QUERY_DETAIL = 'page must not be less than 1';
const INVALID_INSIGHTS_QUERY_DETAIL =
  'year must be omitted, "all", or a calendar year between 2000 and 2100';

function validationProblem(detail: string): ProblemExpectation {
  return { status: 400, title: 'BAD_REQUEST', code: 'SYS_003', detail };
}

const listItem: ApplicationListItem = {
  id: APPLICATION_ID,
  programId: PROGRAM_ID,
  status: ApplicationStatus.SUBMITTED,
  submittedAt: SUBMITTED_AT,
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: false,
    jobStatus: 'DISABLED',
    updatedAt: UPDATED_AT,
    safeErrorClass: null,
  },
  repositoryConnectionMode: RepositoryConnectionMode.NEW,
  repositoryUrl: null,
  repository: null,
  isRepositoryPublicationPlanned: true,
  participation: 'TEAM',
  applicant: {
    id: 'cuid-synthetic-applicant',
    name: null,
    nickname: 'synthetic-applicant',
  },
  team: { id: 'synthetic-team', name: '합성 팀', memberCount: 3 },
  answers: {
    applicantName: '합성 신청자',
    title: '합성 제목',
    summary: '합성 요약',
  },
};
const reviewHistoryEntry: ApplicationReviewHistoryEntry = {
  id: 'synthetic-review-history',
  eventKind: ApplicationReviewEventKind.SUBMITTED,
  revision: 1,
  actor: { name: null, nickname: 'synthetic-applicant' },
  occurredAt: SUBMITTED_AT,
  rejectionReason: null,
};
const listPage: ApplicationListPage = {
  items: [listItem],
  page: 1,
  pageSize: 20,
  totalItems: 1,
  totalPages: 1,
};
const teamManagementPage: TeamManagementListPage = {
  items: [
    {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      status: ApplicationStatus.SUBMITTED,
      submittedAt: SUBMITTED_AT,
      rejectionReason: null,
      applicant: listItem.applicant,
      team: {
        id: 'synthetic-team',
        name: '합성 팀',
        memberCount: 1,
        members: [
          {
            id: 'cuid-synthetic-applicant',
            name: null,
            nickname: 'synthetic-applicant',
          },
        ],
      },
    },
  ],
  page: 1,
  pageSize: 20,
  totalItems: 1,
  totalPages: 1,
};
const dashboardSummary: StaffDashboardSummary = {
  programs: [
    {
      coverId: null,
      coverExternalImageUrl: null,
      id: PROGRAM_ID,
      name: '합성 프로그램',
      trackType: ProgramTrackType.EXTRACURRICULAR,
      applicationPeriod: {
        startsAt: new Date('2026-07-01T00:00:00.000Z'),
        endsAt: new Date('2026-07-31T23:59:59.000Z'),
      },
      endAt: new Date('2026-09-30T23:59:59.000Z'),
      lifecycle: ProgramLifecycle.PUBLISHED,
      applications: { total: 2, submitted: 1, approved: 1, rejected: 0 },
      teamManagementPath: `/programs/${PROGRAM_ID}/teams`,
    },
  ],
};
const programRecord = {
  id: PROGRAM_ID,
  name: '합성 프로그램',
  lifecycle: ProgramLifecycle.PUBLISHED,
};
const decisionTarget: ApplicationDecisionTarget = {
  id: APPLICATION_ID,
  programId: PROGRAM_ID,
  programName: '합성 프로그램',
  applicantGithubLogin: 'synthetic-applicant',
  teamId: 'synthetic-team',
  status: ApplicationStatus.SUBMITTED,
  repositoryProvisioningEnabled: false,
  collaboratorGithubLogins: ['synthetic-applicant'],
  notificationRecipientIds: ['cuid-synthetic-applicant'],
  repositoryConnectionMode: RepositoryConnectionMode.NEW,
  repositoryUrl: null,
  processedById: null,
  processedAt: null,
};

const listItemBody = {
  id: APPLICATION_ID,
  programId: PROGRAM_ID,
  status: ApplicationStatus.SUBMITTED,
  submittedAt: '2026-08-05T05:32:00.000Z',
  rejectionReason: null,
  repositoryProvisioning: {
    enabled: false,
    jobStatus: 'DISABLED',
    updatedAt: '2026-08-06T01:00:00.000Z',
    safeErrorClass: null,
  },
  repositoryConnectionMode: RepositoryConnectionMode.NEW,
  repositoryUrl: null,
  repository: null,
  isRepositoryPublicationPlanned: true,
  participation: 'TEAM',
  applicant: {
    id: 'cuid-synthetic-applicant',
    name: null,
    nickname: 'synthetic-applicant',
  },
  team: { id: 'synthetic-team', name: '합성 팀', memberCount: 3 },
  answers: {
    applicantName: '합성 신청자',
    title: '합성 제목',
    summary: '합성 요약',
  },
};
const detailBody = {
  ...listItemBody,
  reviewHistory: [
    {
      id: 'synthetic-review-history',
      eventKind: ApplicationReviewEventKind.SUBMITTED,
      revision: 1,
      actor: { name: null, nickname: 'synthetic-applicant' },
      occurredAt: '2026-08-05T05:32:00.000Z',
      rejectionReason: null,
    },
  ],
};
const listPageBody = {
  items: [listItemBody],
  page: 1,
  pageSize: 20,
  totalItems: 1,
  totalPages: 1,
};
const teamManagementPageBody = {
  items: [
    {
      id: APPLICATION_ID,
      programId: PROGRAM_ID,
      status: ApplicationStatus.SUBMITTED,
      submittedAt: '2026-08-05T05:32:00.000Z',
      rejectionReason: null,
      applicant: {
        id: 'cuid-synthetic-applicant',
        name: null,
        nickname: 'synthetic-applicant',
      },
      team: {
        id: 'synthetic-team',
        name: '합성 팀',
        memberCount: 1,
        members: [
          {
            id: 'cuid-synthetic-applicant',
            name: null,
            nickname: 'synthetic-applicant',
          },
        ],
      },
    },
  ],
  page: 1,
  pageSize: 20,
  totalItems: 1,
  totalPages: 1,
};
const summaryBody = {
  programs: [
    {
      coverImageUrl: null,
      id: PROGRAM_ID,
      name: '합성 프로그램',
      trackType: ProgramTrackType.EXTRACURRICULAR,
      applicationPeriod: {
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-31T23:59:59.000Z',
      },
      endAt: '2026-09-30T23:59:59.000Z',
      lifecycle: ProgramLifecycle.PUBLISHED,
      applications: {
        total: 2,
        submitted: 1,
        pendingApproval: 1,
        approved: 1,
        rejected: 0,
      },
      teamManagementPath: `/programs/${PROGRAM_ID}/teams`,
      activity: {
        repositories: 0,
        commits: 0,
        pullRequests: 0,
        releases: 0,
        lastActivityAt: null,
        dataAsOf: null,
      },
      submissions: {
        approvedApplications: 0,
        milestones: 0,
        total: 0,
        notSubmitted: 0,
        submitted: 0,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    },
  ],
};
const zeroMetrics = {
  studentCount: 0,
  activeStudentCount: 0,
  commitCount: 0,
  pullRequestCount: 0,
  issueCount: 0,
  repositoryCount: 0,
  starCount: 0,
  total: 0,
  participantCount: 0,
};
const insightsBody = {
  scope: { kind: 'all' },
  dataAsOf: null,
  years: [],
  cohorts: [
    { cohort: 'sw-major', ...zeroMetrics },
    { cohort: 'non-sw', ...zeroMetrics },
    { cohort: 'unregistered', ...zeroMetrics },
  ],
  departments: [],
  programs: [],
};
const decisionBody = {
  applicationId: APPLICATION_ID,
  status: ApplicationStatus.APPROVED,
  repositoryProvisioning: { enabled: false, eventId: null, jobStatus: null },
};

const findApplicationForStaff = jest.fn().mockResolvedValue(listItem);
const listReviewHistory = jest.fn().mockResolvedValue([reviewHistoryEntry]);
const findProgramById = jest.fn().mockResolvedValue(programRecord);
const listApplicationsForProgram = jest.fn().mockResolvedValue(listPage);
const listTeamManagementForProgram = jest
  .fn()
  .mockResolvedValue(teamManagementPage);
const listStaffDashboardSummary = jest.fn().mockResolvedValue(dashboardSummary);
const findApplicationById = jest.fn().mockResolvedValue(decisionTarget);
const transitionApplication = jest.fn().mockResolvedValue(true);
const appendReviewHistory = jest.fn().mockResolvedValue({ revision: 1 });
const createApplicationDecisionNotifications = jest
  .fn()
  .mockResolvedValue(undefined);
const findRepositoryProvisionJob = jest.fn().mockResolvedValue(null);
const findRepositoryProvisionEvent = jest.fn().mockResolvedValue(null);
const discardRepositoryProvisionRequest = jest
  .fn()
  .mockResolvedValue(undefined);
const createRepositoryProvisionEvent = jest.fn();
const transactionStore = {
  auditLogWriter: {},
  appendReviewHistory,
  findApplicationById,
  findRepositoryProvisionJob,
  findRepositoryProvisionEvent,
  discardRepositoryProvisionRequest,
  transitionApplication,
  createApplicationDecisionNotifications,
  createRepositoryProvisionEvent,
};
const withTransaction = jest.fn(
  (operation: (store: typeof transactionStore) => Promise<unknown>) =>
    operation(transactionStore),
);
const record = jest.fn();
const applicationsRepository = {
  findApplicationForStaff,
  listReviewHistory,
  findProgramById,
  listApplicationsForProgram,
  listTeamManagementForProgram,
  listStaffDashboardSummary,
  findRepositoryProvisionEvent,
  withTransaction,
} as unknown as ApplicationsRepository;
const findActorByGithubId = jest.fn((githubId: bigint) =>
  Promise.resolve(
    actors.find((actor) => actor.githubId === githubId)?.row ?? null,
  ),
);
const authority = new UsersAuthorityService({ findActorByGithubId });
const applicationsService = new ApplicationsService(
  applicationsRepository,
  { record } as unknown as AuditLogService,
  authority,
);
const summarizeActivity = jest.fn().mockResolvedValue([]);
const listSubmissionsByProgram = jest.fn().mockResolvedValue([]);
const staffDashboardService = new StaffDashboardService(
  applicationsService,
  { summarize: summarizeActivity },
  { listByProgram: listSubmissionsByProgram },
);
const listStudents = jest.fn().mockResolvedValue([]);
const listApprovedParticipations = jest.fn().mockResolvedValue([]);
const listActivityTotals = jest.fn().mockResolvedValue([]);
const findActivityDataAsOf = jest.fn().mockResolvedValue(null);
const listActivityYears = jest.fn().mockResolvedValue([]);
const staffInsightsService = new StaffInsightsService(
  {
    listStudents,
    listApprovedParticipations,
    listActivityTotals,
    findActivityDataAsOf,
    listActivityYears,
  } as unknown as StaffInsightsRepository,
  authority,
);
const getMe = jest.fn((githubId: bigint) =>
  Promise.resolve({ id: `cuid-principal-${githubId}`, sessionVersion: 0 }),
);

let application: INestApplication | undefined;
let baseUrl = '';
const cookies = new Map<string, string>();

async function issueCookie(githubId: bigint): Promise<string> {
  const token = await issueSessionToken(sessionSecret, githubId, 0);
  return `${sessionCookieName(false)}=${token}`;
}

function cookieFor(actor: Actor): string | undefined {
  return actor.githubId === null ? undefined : cookies.get(actor.label);
}

function actorId(actor: Actor): string {
  if (actor.row === null) {
    throw new Error(`${actor.label} 는 사용자 행이 없는 합성 actor 다`);
  }
  return actor.row.id;
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = JSON.parse(await response.text());
  return body;
}

async function send(input: {
  readonly method: 'GET' | 'PATCH';
  readonly path: string;
  readonly cookie?: string;
  readonly origin?: string;
  readonly body?: Record<string, unknown>;
}): Promise<Response> {
  return fetch(`${baseUrl}${input.path}`, {
    method: input.method,
    headers: {
      connection: 'close',
      ...(input.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(input.cookie === undefined ? {} : { cookie: input.cookie }),
      ...(input.origin === undefined ? {} : { origin: input.origin }),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
}

async function expectProblem(
  response: Response,
  expected: ProblemExpectation,
  instance: string,
): Promise<void> {
  expect(response.status).toBe(expected.status);
  expect(await readJson(response)).toEqual({
    type: 'about:blank',
    title: expected.title,
    status: expected.status,
    detail: expected.detail,
    instance,
    code: expected.code,
  });
}

function deniedReadProblem(actor: Actor): ProblemExpectation {
  return actor.githubId === null ? UNAUTHENTICATED : STAFF_LIST_ONLY;
}

function deniedDecisionProblem(actor: Actor): ProblemExpectation {
  return actor.githubId === null ? UNAUTHENTICATED : STAFF_ONLY;
}

interface ReadRoute {
  readonly label: string;
  readonly path: string;
  readonly instance: string;
  readonly body: unknown;
}

const readRoutes: readonly ReadRoute[] = [
  {
    label: 'application detail',
    path: decisionPath,
    instance: decisionPath,
    body: detailBody,
  },
  {
    label: 'program applications list',
    path: listPath,
    instance: listPath,
    body: listPageBody,
  },
  {
    label: 'program team-management list',
    path: `${listPath}?view=team-management`,
    instance: listPath,
    body: teamManagementPageBody,
  },
  {
    label: 'staff dashboard summary',
    path: summaryPath,
    instance: summaryPath,
    body: summaryBody,
  },
  {
    label: 'staff dashboard insights',
    path: insightsPath,
    instance: insightsPath,
    body: insightsBody,
  },
];

interface InvalidQueryRoute {
  readonly label: string;
  readonly path: string;
  readonly instance: string;
  readonly detail: string;
  readonly notReached: jest.Mock;
}

const invalidQueryRoutes: readonly InvalidQueryRoute[] = [
  {
    label: 'program applications list',
    path: `${listPath}?page=0`,
    instance: listPath,
    detail: INVALID_LIST_QUERY_DETAIL,
    notReached: findProgramById,
  },
  {
    label: 'staff dashboard insights',
    path: `${insightsPath}?year=invalid`,
    instance: insightsPath,
    detail: INVALID_INSIGHTS_QUERY_DETAIL,
    notReached: listStudents,
  },
];

const origins = [
  { label: 'valid Origin', header: allowedOrigin },
  { label: 'foreign Origin', header: foreignOrigin },
  { label: 'missing Origin', header: undefined },
] as const;

const decisionBodies = [
  { label: 'valid body', value: { action: 'APPROVE' }, problem: null },
  {
    label: 'invalid body',
    value: { action: 'APPROVE', isRepositoryPublicationPlanned: false },
    problem: validationProblem(INVALID_DECISION_BODY_DETAIL),
  },
  {
    label: 'invalid action type',
    value: { action: 42 },
    problem: validationProblem('action must be a string'),
  },
  {
    label: 'unknown action',
    value: { action: 'UNKNOWN' },
    problem: {
      status: 400,
      title: 'BAD_REQUEST',
      code: 'APP_006',
      detail: '지원하지 않는 승인·반려 방식입니다.',
    },
  },
  {
    label: 'missing rejection reason',
    value: { action: 'REJECT' },
    problem: {
      status: 400,
      title: 'BAD_REQUEST',
      code: 'APP_003',
      detail: '반려 사유를 입력해 주세요.',
    },
  },
  {
    label: 'blank rejection reason',
    value: { action: 'REJECT', reason: '   ' },
    problem: {
      status: 400,
      title: 'BAD_REQUEST',
      code: 'APP_003',
      detail: '반려 사유를 입력해 주세요.',
    },
  },
] as const;

const readCases = actors.flatMap((actor) =>
  readRoutes.map((route) => ({
    title: `GET ${route.label} · ${actor.label}`,
    actor,
    route,
  })),
);

const decisionCases = actors.flatMap((actor) =>
  origins.flatMap((origin) =>
    decisionBodies.map((body) => ({
      title: `PATCH decide · ${actor.label} · ${origin.label} · ${body.label}`,
      actor,
      origin,
      body,
    })),
  ),
);

const invalidQueryCases = actors.flatMap((actor) =>
  invalidQueryRoutes.map((route) => ({
    title: `GET ${route.label} invalid query · ${actor.label}`,
    actor,
    route,
  })),
);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      ApplicationsController,
      ProgramApplicationsController,
      StaffDashboardController,
    ],
    providers: [
      SessionGuard,
      OriginGuard,
      { provide: ApplicationsService, useValue: applicationsService },
      { provide: StaffDashboardService, useValue: staffDashboardService },
      { provide: StaffInsightsService, useValue: staffInsightsService },
      { provide: AuthService, useValue: { getMe } },
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
    ],
  }).compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
  for (const actor of actors) {
    if (actor.githubId !== null) {
      cookies.set(actor.label, await issueCookie(actor.githubId));
    }
  }
  cookies.set('unknown user', await issueCookie(UNKNOWN_GITHUB_ID));
});

beforeEach(() => {
  jest.clearAllMocks();
  findApplicationForStaff.mockResolvedValue(listItem);
  findApplicationById.mockResolvedValue(decisionTarget);
  findProgramById.mockResolvedValue(programRecord);
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it.each(readCases)(
  '$title 의 현재 응답 계약을 고정한다',
  async ({ actor, route }) => {
    const response = await send({
      method: 'GET',
      path: route.path,
      cookie: cookieFor(actor),
    });

    if (actor.allowed) {
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(route.body);
      return;
    }
    await expectProblem(response, deniedReadProblem(actor), route.instance);
  },
);

it.each(decisionCases)(
  '$title 의 세션·Origin·형식 검증·권한·의미 검증 순서를 고정한다',
  async ({ actor, origin, body }) => {
    const response = await send({
      method: 'PATCH',
      path: decisionPath,
      cookie: cookieFor(actor),
      origin: origin.header,
      body: { ...body.value },
    });

    if (actor.githubId === null) {
      await expectProblem(response, deniedDecisionProblem(actor), decisionPath);
      expect(findActorByGithubId).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
      return;
    }
    if (origin.header !== allowedOrigin) {
      await expectProblem(response, ORIGIN_FORBIDDEN, decisionPath);
      expect(findActorByGithubId).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
      return;
    }
    if (body.problem?.code === 'SYS_003') {
      await expectProblem(response, body.problem, decisionPath);
      expect(findActorByGithubId).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
      return;
    }
    if (!actor.allowed) {
      await expectProblem(response, deniedDecisionProblem(actor), decisionPath);
      expect(withTransaction).not.toHaveBeenCalled();
      return;
    }
    if (body.problem !== null) {
      await expectProblem(response, body.problem, decisionPath);
      expect(findActorByGithubId).toHaveBeenCalledWith(actor.githubId);
      expect(withTransaction).not.toHaveBeenCalled();
      return;
    }

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual(decisionBody);
    expect(transitionApplication).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      expectedStatus: ApplicationStatus.SUBMITTED,
      nextStatus: ApplicationStatus.APPROVED,
      rejectionReason: null,
      processedBy: { id: actorId(actor), at: expect.any(Date) as unknown },
    });
    expect(appendReviewHistory).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      eventKind: ApplicationReviewEventKind.APPROVED,
      actorId: actorId(actor),
      occurredAt: expect.any(Date) as unknown,
      rejectionReason: null,
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorGithubId: actor.githubId,
        targetType: 'APPLICATION',
        targetId: APPLICATION_ID,
      }),
      transactionStore.auditLogWriter,
    );
  },
);

it.each(invalidQueryCases)(
  '$title 의 현재 응답 계약을 고정한다',
  async ({ actor, route }) => {
    const response = await send({
      method: 'GET',
      path: route.path,
      cookie: cookieFor(actor),
    });

    await expectProblem(
      response,
      actor.githubId !== null
        ? validationProblem(route.detail)
        : deniedReadProblem(actor),
      route.instance,
    );
    expect(route.notReached).not.toHaveBeenCalled();
    expect(findActorByGithubId).not.toHaveBeenCalled();
  },
);

it.each([
  {
    title: 'GET application detail',
    method: 'GET' as const,
    problem: STAFF_LIST_ONLY,
    body: undefined,
  },
  {
    title: 'PATCH decide',
    method: 'PATCH' as const,
    problem: STAFF_ONLY,
    body: { action: 'APPROVE' },
  },
])(
  'session 은 유효하지만 사용자 행이 없으면 $title 은 모듈 403 을 유지한다',
  async ({ method, problem, body }) => {
    const response = await send({
      method,
      path: decisionPath,
      cookie: cookies.get('unknown user'),
      origin: allowedOrigin,
      body,
    });

    await expectProblem(response, problem, decisionPath);
    expect(withTransaction).not.toHaveBeenCalled();
    expect(findApplicationForStaff).not.toHaveBeenCalled();
  },
);

const missingResourceRoutes = [
  {
    label: 'application detail',
    method: 'GET' as const,
    path: decisionPath,
    instance: decisionPath,
    body: undefined,
    allowedProblem: APPLICATION_NOT_FOUND,
    deniedProblem: STAFF_LIST_ONLY,
    absent: () => findApplicationForStaff.mockResolvedValue(null),
  },
  {
    label: 'decide',
    method: 'PATCH' as const,
    path: decisionPath,
    instance: decisionPath,
    body: { action: 'APPROVE' },
    allowedProblem: APPLICATION_NOT_FOUND,
    deniedProblem: STAFF_ONLY,
    absent: () => findApplicationById.mockResolvedValue(null),
  },
  {
    label: 'program applications list',
    method: 'GET' as const,
    path: listPath,
    instance: listPath,
    body: undefined,
    allowedProblem: PROGRAM_NOT_FOUND,
    deniedProblem: STAFF_LIST_ONLY,
    absent: () => findProgramById.mockResolvedValue(null),
  },
];

it.each(
  missingResourceRoutes.flatMap((route) =>
    ['STAFF', 'STUDENT'].map((label) => ({
      title: `${route.label} · ${label}`,
      label,
      route,
    })),
  ),
)(
  '없는 대상에 대한 $title 의 현재 응답 계약을 고정한다',
  async ({ label, route }) => {
    const actor = actors.find((candidate) => candidate.label === label);
    if (actor === undefined) {
      throw new Error(`${label} 합성 actor 가 없다`);
    }
    route.absent();

    const response = await send({
      method: route.method,
      path: route.path,
      cookie: cookieFor(actor),
      origin: allowedOrigin,
      body: route.body,
    });

    await expectProblem(
      response,
      actor.allowed ? route.allowedProblem : route.deniedProblem,
      route.instance,
    );
  },
);

it('isRepositoryPublicationPlanned 를 담은 PATCH decide 요청은 400 SYS_003 으로 거부되고 service 판정 트랜잭션은 열리지 않는다', async () => {
  const response = await send({
    method: 'PATCH',
    path: decisionPath,
    cookie: cookies.get('STAFF'),
    origin: allowedOrigin,
    body: { action: 'APPROVE', isRepositoryPublicationPlanned: false },
  });

  await expectProblem(
    response,
    validationProblem(INVALID_DECISION_BODY_DETAIL),
    decisionPath,
  );
  expect(withTransaction).not.toHaveBeenCalled();
});

it('whitelist 필드만 보낸 정상 PATCH decide 는 통과한다(대조군)', async () => {
  const response = await send({
    method: 'PATCH',
    path: decisionPath,
    cookie: cookies.get('STAFF'),
    origin: allowedOrigin,
    body: { action: 'APPROVE' },
  });

  expect(response.status).toBe(200);
  expect(await readJson(response)).toEqual(decisionBody);
  expect(withTransaction).toHaveBeenCalledTimes(1);
});
