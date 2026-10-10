import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, ProgramCategory } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { AuditLogService } from '../audit-log/service/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/service/auth.service';
import { AuthErrorCode } from '../auth/domain/auth-error-code.enum';
import { OriginGuard } from '../auth/controller/origin.guard';
import { sessionCookieName } from '../auth/domain/cookies';
import { issueSessionToken } from '../auth/domain/session-token';
import { SessionGuard } from '../auth/controller/session.guard';
import { ProblemDetailFilter } from '../common/controller/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { TeamsErrorCode } from './teams-error-code.enum';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import type {
  ProgramTeamsRepository,
  StaffTeamDetailRecord,
  StaffTeamRecord,
  TeamProgramRecord,
} from './repository/program-teams.repository';
import { ProgramTeamsService } from './service/program-teams.service';
import {
  EMPTY_TEAM_DELETION_SCOPE,
  stubTeamDeletionRepository,
} from './service/program-teams.service.test-support';

const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(7);
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const JOIN_CODE_SECRET = 'synthetic-program-teams-secret';
const LIST_INSTANCE = `/api/v1/programs/${PROGRAM_ID}/teams`;
const DETAIL_INSTANCE = `${LIST_INSTANCE}/${TEAM_ID}`;
const UNAUTHENTICATED_DETAIL = '로그인이 필요합니다.';
const STAFF_ONLY_DETAIL = '교직원 계정만 참여 팀 목록을 볼 수 있습니다.';

const TEAM_PROGRAM: TeamProgramRecord = {
  id: PROGRAM_ID,
  name: '합성 프로그램',
  category: ProgramCategory.OSS_CONTEST,
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  teamMinSize: 2,
  teamMaxSize: 4,
};

const TEAM_MEMBER_RECORDS = [
  { userId: 'user-a', nickname: 'login-a', name: '가나다' },
  { userId: 'user-b', nickname: 'login-b', name: null },
];

const TEAM_MEMBER_VIEWS = [
  { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
  { userId: 'user-b', name: null, nickname: 'login-b', isLeader: false },
];

const STAFF_TEAM: StaffTeamRecord = {
  id: 'team-1',
  name: '오픈소스팀',
  leaderId: 'user-a',
  members: TEAM_MEMBER_RECORDS,
};

const STAFF_TEAM_BODY = {
  teamId: 'team-1',
  name: '오픈소스팀',
  memberCount: 2,
  members: TEAM_MEMBER_VIEWS,
};

const STAFF_TEAM_DETAIL: StaffTeamDetailRecord = {
  id: TEAM_ID,
  name: '오픈소스팀',
  leaderId: 'user-a',
  members: TEAM_MEMBER_RECORDS,
  application: null,
  repositoryContributions: null,
  repositoryUrlHistory: { items: [], nextCursor: null },
};

const STAFF_TEAM_DETAIL_BODY = {
  teamId: TEAM_ID,
  name: '오픈소스팀',
  memberCount: 2,
  members: TEAM_MEMBER_VIEWS,
  application: null,
  repositoryContributions: null,
  repositoryUrlHistory: { items: [], nextCursor: null },
  deletionScope: EMPTY_TEAM_DELETION_SCOPE,
};

const STUDENT_USER = {
  id: 'synthetic-student',
  hasStaffAccess: false,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};

const INACTIVE_STAFF_USER = {
  id: 'synthetic-inactive-staff',
  hasStaffAccess: true,
  hasAdminAccess: false,
  accountStatus: AccountStatus.DEACTIVATED,
};

const STAFF_USER = {
  id: 'synthetic-staff',
  hasStaffAccess: true,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};

const ADMIN_USER = {
  id: 'synthetic-admin',
  hasStaffAccess: false,
  hasAdminAccess: true,
  accountStatus: AccountStatus.ACTIVE,
};

function unauthenticatedProblem(instance: string) {
  return {
    type: 'about:blank',
    title: 'UNAUTHORIZED',
    status: 401,
    detail: UNAUTHENTICATED_DETAIL,
    instance,
    code: AuthErrorCode.UNAUTHENTICATED,
  };
}

function staffOnlyProblem(instance: string) {
  return {
    type: 'about:blank',
    title: 'FORBIDDEN',
    status: 403,
    detail: STAFF_ONLY_DETAIL,
    instance,
    code: TeamsErrorCode.STAFF_ONLY,
  };
}

const findProgramById = jest.fn();
const listStaffTeams = jest.fn();
const findStaffTeamDetail = jest.fn();
const findUnique = jest.fn();

const repository = {
  findProgramById,
  listStaffTeams,
  findStaffTeamDetail,
} as unknown as ProgramTeamsRepository;

const service = new ProgramTeamsService(
  repository,
  loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
  { record: jest.fn() } as unknown as AuditLogService,
  stubTeamDeletionRepository(),
);

const listForStaff = jest.fn(
  (...args: Parameters<ProgramTeamsService['listForStaff']>) =>
    service.listForStaff(...args),
);
const getForStaff = jest.fn(
  (...args: Parameters<ProgramTeamsService['getForStaff']>) =>
    service.getForStaff(...args),
);

const guardedRoutes = [
  {
    route: 'GET 목록',
    path: '',
    instance: LIST_INSTANCE,
    success: [STAFF_TEAM_BODY] as unknown,
  },
  {
    route: 'GET 상세',
    path: `/${TEAM_ID}`,
    instance: DETAIL_INSTANCE,
    success: STAFF_TEAM_DETAIL_BODY as unknown,
  },
];

const actors = [
  { role: 'anonymous', githubId: null, user: null, allowed: false },
  { role: 'STUDENT', githubId: 5101n, user: STUDENT_USER, allowed: false },
  {
    role: '비활성 STAFF',
    githubId: 5102n,
    user: INACTIVE_STAFF_USER,
    allowed: false,
  },
  { role: 'STAFF', githubId: 5103n, user: STAFF_USER, allowed: true },
  { role: 'ADMIN', githubId: 5104n, user: ADMIN_USER, allowed: true },
];

const guardedCells = actors.flatMap((actor) =>
  guardedRoutes.map((guarded) => ({
    ...actor,
    ...guarded,
    status: actor.githubId === null ? 401 : actor.allowed ? 200 : 403,
    expected:
      actor.githubId === null
        ? unauthenticatedProblem(guarded.instance)
        : actor.allowed
          ? guarded.success
          : staffOnlyProblem(guarded.instance),
  })),
);

const inputCells = [
  { role: 'STAFF', githubId: 5103n, user: STAFF_USER, status: 200 },
  { role: 'STUDENT', githubId: 5101n, user: STUDENT_USER, status: 403 },
].flatMap((actor) =>
  guardedRoutes.map((guarded) => ({
    ...actor,
    ...guarded,
    expected:
      actor.status === 200
        ? guarded.success
        : staffOnlyProblem(guarded.instance),
  })),
);

let application: INestApplication | undefined;
let baseUrl = '';

async function getTeams(
  cookie: string | null,
  path = '',
  origin: string | null = null,
): Promise<Response> {
  return fetch(`${baseUrl}${LIST_INSTANCE}${path}`, {
    method: 'GET',
    headers: {
      connection: 'close',
      ...(cookie === null ? {} : { cookie }),
      ...(origin === null ? {} : { origin }),
    },
  });
}

async function sessionCookieFor(githubId: bigint): Promise<string> {
  const token = await issueSessionToken(sessionSecret, githubId, 0);
  return `${sessionCookieName(false)}=${token}`;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramTeamsController],
    providers: [
      { provide: ProgramTeamsService, useValue: { listForStaff, getForStaff } },
      SessionGuard,
      ProgramTeamsStaffGuard,
      OriginGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'synthetic', sessionVersion: 0 }),
        },
      },
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
      { provide: PrismaService, useValue: { user: { findUnique } } },
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
});

beforeEach(() => {
  listForStaff.mockClear();
  getForStaff.mockClear();
  findUnique.mockReset();
  findProgramById.mockReset();
  findProgramById.mockResolvedValue(TEAM_PROGRAM);
  listStaffTeams.mockReset();
  listStaffTeams.mockResolvedValue([STAFF_TEAM]);
  findStaffTeamDetail.mockReset();
  findStaffTeamDetail.mockResolvedValue(STAFF_TEAM_DETAIL);
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('ACTIVE STAFF 는 팀 목록 배열을 200 으로 받는다', async () => {
  findUnique.mockResolvedValue(STAFF_USER);

  const response = await getTeams(await sessionCookieFor(5001n));

  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toEqual([
    {
      teamId: 'team-1',
      name: '오픈소스팀',
      memberCount: 2,
      members: [
        {
          userId: 'user-a',
          name: '가나다',
          nickname: 'login-a',
          isLeader: true,
        },
        { userId: 'user-b', name: null, nickname: 'login-b', isLeader: false },
      ],
    },
  ]);

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'studentId',
    'department',
    'phone',
    'email',
    'joinCode',
    'joinCodeDigest',
    'repository',
    'repositories',
    'url',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(listForStaff).toHaveBeenCalledWith(PROGRAM_ID);
  expect(listStaffTeams).toHaveBeenCalledWith(PROGRAM_ID);
});

it('ACTIVE ADMIN 도 통과한다', async () => {
  findUnique.mockResolvedValue(ADMIN_USER);
  listStaffTeams.mockResolvedValue([]);

  const response = await getTeams(await sessionCookieFor(5002n));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual([]);
});

it.each([
  ['STUDENT', 'STUDENT', AccountStatus.ACTIVE],
  ['역할 미지정', null, AccountStatus.ACTIVE],
  ['비활성 STAFF', 'STAFF', AccountStatus.DEACTIVATED],
])(
  '%s 계정은 403 TEAM_003 로 막히고 service 를 호출하지 않는다',
  async (_label, role, accountStatus) => {
    findUnique.mockResolvedValue({ id: 'synthetic-user', role, accountStatus });

    const response = await getTeams(await sessionCookieFor(5003n));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      type: 'about:blank',
      status: 403,
      code: TeamsErrorCode.STAFF_ONLY,
      instance: `/api/v1/programs/${PROGRAM_ID}/teams`,
    });
    expect(listForStaff).not.toHaveBeenCalled();
  },
);

it('세션 쿠키가 없으면 401 이고 staff 가드까지 가지 않는다', async () => {
  const response = await getTeams(null);

  expect(response.status).toBe(401);
  expect(findUnique).not.toHaveBeenCalled();
  expect(listForStaff).not.toHaveBeenCalled();
});

it('세션 쿠키가 위조되면 401 이다', async () => {
  const response = await getTeams(`${sessionCookieName(false)}=not-a-token`);

  expect(response.status).toBe(401);
  expect(listForStaff).not.toHaveBeenCalled();
});

it.each(guardedCells)(
  '$role 의 $route 응답은 상태와 본문을 그대로 유지한다',
  async ({ githubId, user, path, status, expected }) => {
    findUnique.mockResolvedValue(user);

    const response = await getTeams(
      githubId === null ? null : await sessionCookieFor(githubId),
      path,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(expected);
    if (status !== 200) {
      expect(listStaffTeams).not.toHaveBeenCalled();
      expect(findStaffTeamDetail).not.toHaveBeenCalled();
    }
  },
);

it.each(inputCells)(
  '$role 의 $route 요청은 입력 DTO 가 없어 알 수 없는 query 로도 400 이 되지 않는다',
  async ({ githubId, user, path, status, expected }) => {
    findUnique.mockResolvedValue(user);

    const response = await getTeams(
      await sessionCookieFor(githubId),
      `${path}?unknown=1`,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(expected);
  },
);

it.each(inputCells)(
  '$role 의 $route 요청은 OriginGuard 가 없어 다른 origin 에서도 같은 응답을 준다',
  async ({ githubId, user, path, status, expected }) => {
    findUnique.mockResolvedValue(user);

    const response = await getTeams(
      await sessionCookieFor(githubId),
      path,
      'http://evil.test',
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(expected);
  },
);

it('프로그램이 없으면 STAFF 목록 요청도 404 TEAM_002 다', async () => {
  findUnique.mockResolvedValue(STAFF_USER);
  findProgramById.mockResolvedValue(null);

  const response = await getTeams(await sessionCookieFor(5103n));

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    type: 'about:blank',
    title: 'NOT_FOUND',
    status: 404,
    detail: '프로그램을 찾을 수 없습니다.',
    instance: LIST_INSTANCE,
    code: TeamsErrorCode.PROGRAM_NOT_FOUND,
  });
  expect(listStaffTeams).not.toHaveBeenCalled();
});

it('대상 팀이 없으면 STAFF 상세 요청은 404 TEAM_010 이다', async () => {
  findUnique.mockResolvedValue(STAFF_USER);
  findStaffTeamDetail.mockResolvedValue(null);

  const response = await getTeams(await sessionCookieFor(5103n), `/${TEAM_ID}`);

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    type: 'about:blank',
    title: 'NOT_FOUND',
    status: 404,
    detail: '소속된 팀이 없습니다.',
    instance: DETAIL_INSTANCE,
    code: TeamsErrorCode.TEAM_NOT_FOUND,
  });
  expect(getForStaff).toHaveBeenCalledWith(PROGRAM_ID, TEAM_ID);
});
