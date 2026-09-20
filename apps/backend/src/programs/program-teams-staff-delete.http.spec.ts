import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { DomainException } from '../common/error-code';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from './teams-error-code.enum';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import { ProgramTeamsService } from './service/program-teams.service';

/**
 * 교직원 팀 삭제(DELETE /api/v1/programs/:programId/teams/:teamId)를 실제 HTTP
 * 파이프라인(SessionGuard + OriginGuard + ValidationPipe + ProblemDetailFilter)으로
 * 검증한다.
 *
 * 이 route 에는 `ProgramTeamsStaffGuard` 를 붙이지 않는다 — 형제 `PATCH :teamId`(이름
 * 변경)가 팀장도 통과시켜야 해서 가드를 안 쓰기로 했고, 삭제도 새 Guard 클래스를 만드는
 * 대신 `ProgramLifecycleService.purge` 와 같은 모양으로 service 안에서 판정한다.
 * 그래서 「가드가 없어도 학생은 403 이다」를 여기서 못 박는다.
 */
const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(7);
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const INSTANCE = `/api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}`;

const EXPECTED_SCOPE = {
  applications: 1,
  members: 3,
  invitations: 2,
  submissions: 4,
  submissionEvents: 9,
  detachedRepositories: 1,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
};

const deleteForStaff = jest.fn();
const findUnique = jest.fn();

let application: INestApplication | undefined;
let baseUrl = '';

async function deleteTeam(
  cookie: string | null,
  body: unknown = { expectedScope: EXPECTED_SCOPE },
): Promise<Response> {
  return fetch(`${baseUrl}${INSTANCE}`, {
    method: 'DELETE',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      origin: allowedOrigin,
      ...(cookie === null ? {} : { cookie }),
    },
    body: JSON.stringify(body),
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
      { provide: ProgramTeamsService, useValue: { deleteForStaff } },
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
  deleteForStaff.mockReset();
  findUnique.mockReset();
  findUnique.mockResolvedValue({
    id: 'synthetic-staff',
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('확인한 범위를 그대로 보내면 200 과 지운 수치를 받는다', async () => {
  const deletedCounts = {
    applications: 1,
    members: 3,
    invitations: 2,
    submissions: 4,
    submissionEvents: 9,
    detachedRepositories: 1,
  };
  deleteForStaff.mockResolvedValue({
    teamId: TEAM_ID,
    deleted: true,
    deletedCounts,
  });

  const response = await deleteTeam(await sessionCookieFor(5001n));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    teamId: TEAM_ID,
    deleted: true,
    deletedCounts,
  });
  expect(deleteForStaff).toHaveBeenCalledWith(
    5001n,
    PROGRAM_ID,
    TEAM_ID,
    EXPECTED_SCOPE,
    // 알림 문구를 보내지 않았으므로 null로 접혀 내려간다.
    null,
  );
});

it('학생 토큰은 service 판정으로 403 TEAM_018 이 된다', async () => {
  deleteForStaff.mockRejectedValue(
    new DomainException(
      TEAMS_ERROR_CODES[TeamsErrorCode.TEAM_DELETE_FORBIDDEN],
    ),
  );

  const response = await deleteTeam(await sessionCookieFor(5002n));

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    status: 403,
    code: TeamsErrorCode.TEAM_DELETE_FORBIDDEN,
    instance: INSTANCE,
  });
});

it('없는 팀·다른 프로그램의 팀은 구분 없이 404 TEAM_017 이다', async () => {
  deleteForStaff.mockRejectedValue(
    new DomainException(
      TEAMS_ERROR_CODES[TeamsErrorCode.TARGET_TEAM_NOT_FOUND],
    ),
  );

  const response = await deleteTeam(await sessionCookieFor(5003n));

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    status: 404,
    code: TeamsErrorCode.TARGET_TEAM_NOT_FOUND,
    instance: INSTANCE,
  });
});

// 확인 이후 범위가 움직이면 409 로 물러나고, 화면이 다시 그릴 수 있게 현재 범위를 싣는다.
it('범위가 어긋나면 409 TEAM_019 와 현재 팀 범위를 함께 돌려준다', async () => {
  const currentTeamScopeCounts = { ...EXPECTED_SCOPE, submissions: 5 };
  deleteForStaff.mockRejectedValue(
    new DomainException(
      TEAMS_ERROR_CODES[TeamsErrorCode.TEAM_DELETE_SCOPE_CHANGED],
      { currentTeamScopeCounts },
    ),
  );

  const response = await deleteTeam(await sessionCookieFor(5004n));

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    status: 409,
    code: TeamsErrorCode.TEAM_DELETE_SCOPE_CHANGED,
    currentTeamScopeCounts,
  });
});

it.each([
  ['본문이 비었으면', {}],
  ['범위가 null 이면', { expectedScope: null }],
  [
    '지문이 없으면',
    { expectedScope: { ...EXPECTED_SCOPE, scopeFingerprint: undefined } },
  ],
  ['수치가 음수면', { expectedScope: { ...EXPECTED_SCOPE, members: -1 } }],
])('%s 400 으로 막고 service 를 부르지 않는다', async (_label, body) => {
  const response = await deleteTeam(await sessionCookieFor(5005n), body);

  expect(response.status).toBe(400);
  expect(deleteForStaff).not.toHaveBeenCalled();
});

it('세션 쿠키가 없으면 401 이고 service 까지 가지 않는다', async () => {
  const response = await deleteTeam(null);

  expect(response.status).toBe(401);
  expect(deleteForStaff).not.toHaveBeenCalled();
});

// 삭제는 상태를 바꾸는 요청이라 CSRF 경계를 지난다.
it('허용되지 않은 origin 은 OriginGuard 가 막는다', async () => {
  const response = await fetch(`${baseUrl}${INSTANCE}`, {
    method: 'DELETE',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      origin: 'http://evil.test',
      cookie: await sessionCookieFor(5006n),
    },
    body: JSON.stringify({ expectedScope: EXPECTED_SCOPE }),
  });

  expect(response.status).toBe(403);
  expect(deleteForStaff).not.toHaveBeenCalled();
});
