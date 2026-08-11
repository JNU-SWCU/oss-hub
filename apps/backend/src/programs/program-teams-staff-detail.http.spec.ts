import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
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
 * 교직원 전용 팀 상세(GET /api/v1/programs/:programId/teams/:teamId, #874)를 실제
 * HTTP 파이프라인(SessionGuard + ProgramTeamsStaffGuard + ProblemDetailFilter)으로
 * 검증한다. 학생 토큰이 403 으로 막히는지, 없는 팀·다른 프로그램의 팀이 구분 없이
 * 404 로 응답하는지 본다. 응답 필드 allowlist 검증은
 * `program-teams-staff-detail-fields.http.spec.ts` 로 분리했다.
 */
const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(7);
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';

const getForStaff = jest.fn();
const findUnique = jest.fn();

let application: INestApplication | undefined;
let baseUrl = '';

async function getTeamDetail(cookie: string | null): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}`, {
    method: 'GET',
    headers: {
      connection: 'close',
      ...(cookie === null ? {} : { cookie }),
    },
  });
}

async function sessionCookieFor(githubId: bigint): Promise<string> {
  const token = await issueSessionToken(sessionSecret, githubId);
  return `${sessionCookieName(false)}=${token}`;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramTeamsController],
    providers: [
      { provide: ProgramTeamsService, useValue: { getForStaff } },
      SessionGuard,
      ProgramTeamsStaffGuard,
      OriginGuard,
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ id: 'synthetic' }) },
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
  getForStaff.mockReset();
  findUnique.mockReset();
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('ACTIVE STAFF 는 팀 상세를 200 으로 받는다', async () => {
  // Given
  findUnique.mockResolvedValue({
    id: 'synthetic-staff',
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
  });
  getForStaff.mockResolvedValue({
    teamId: TEAM_ID,
    name: '오픈소스팀',
    memberCount: 1,
    members: [
      { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
    ],
    application: null,
  });

  // When
  const response = await getTeamDetail(await sessionCookieFor(5001n));

  // Then
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    teamId: TEAM_ID,
    name: '오픈소스팀',
    memberCount: 1,
    members: [
      { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
    ],
    application: null,
  });
  expect(getForStaff).toHaveBeenCalledWith(PROGRAM_ID, TEAM_ID);
});

it.each([
  ['STUDENT', Role.STUDENT, AccountStatus.ACTIVE],
  ['역할 미지정', null, AccountStatus.ACTIVE],
  ['비활성 STAFF', Role.STAFF, AccountStatus.DEACTIVATED],
])(
  '%s 계정은 403 TEAM_003 으로 막히고 service 를 호출하지 않는다',
  async (_label, role, accountStatus) => {
    // Given
    findUnique.mockResolvedValue({ id: 'synthetic-user', role, accountStatus });

    // When
    const response = await getTeamDetail(await sessionCookieFor(5002n));

    // Then
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      type: 'about:blank',
      status: 403,
      code: TeamsErrorCode.STAFF_ONLY,
      instance: `/api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}`,
    });
    expect(getForStaff).not.toHaveBeenCalled();
  },
);

it('없는 팀·다른 프로그램의 팀은 구분 없이 404 TEAM_010 이다', async () => {
  // Given
  findUnique.mockResolvedValue({
    id: 'synthetic-staff',
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
  });
  getForStaff.mockRejectedValue(
    new DomainException(TEAMS_ERROR_CODES[TeamsErrorCode.TEAM_NOT_FOUND]),
  );

  // When
  const response = await getTeamDetail(await sessionCookieFor(5003n));

  // Then
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    type: 'about:blank',
    status: 404,
    code: TeamsErrorCode.TEAM_NOT_FOUND,
    instance: `/api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}`,
  });
});

it('세션 쿠키가 없으면 401 이고 staff 가드까지 가지 않는다', async () => {
  const response = await getTeamDetail(null);

  expect(response.status).toBe(401);
  expect(findUnique).not.toHaveBeenCalled();
  expect(getForStaff).not.toHaveBeenCalled();
});

it('세션 쿠키가 위조되면 401 이다', async () => {
  const response = await getTeamDetail(
    `${sessionCookieName(false)}=not-a-token`,
  );

  expect(response.status).toBe(401);
  expect(getForStaff).not.toHaveBeenCalled();
});
