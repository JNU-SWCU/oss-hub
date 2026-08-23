import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsErrorCode } from './teams-error-code.enum';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import { ProgramTeamsService } from './service/program-teams.service';

/**
 * 교직원 전용 팀 목록(GET /api/v1/programs/:programId/teams)을 실제 HTTP 파이프라인
 * (SessionGuard + ProgramTeamsStaffGuard + ProblemDetailFilter)으로 검증한다.
 * 학생·미인증·비활성 계정이 실제로 막히는지, 통과한 응답에 금지 필드가 없는지 본다.
 */
const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(7);
const PROGRAM_ID = 'synthetic-program';

const listForStaff = jest.fn();
const findUnique = jest.fn();

let application: INestApplication | undefined;
let baseUrl = '';

async function getTeams(cookie: string | null): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/programs/${PROGRAM_ID}/teams`, {
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
      { provide: ProgramTeamsService, useValue: { listForStaff } },
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
  listForStaff.mockReset();
  findUnique.mockReset();
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('ACTIVE STAFF 는 팀 목록 배열을 200 으로 받는다', async () => {
  // Given
  findUnique.mockResolvedValue({
    id: 'synthetic-staff',
    role: 'STAFF',
    accountStatus: AccountStatus.ACTIVE,
  });
  listForStaff.mockResolvedValue([
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
        {
          userId: 'user-b',
          name: null,
          nickname: 'login-b',
          isLeader: false,
        },
      ],
    },
  ]);

  // When
  const response = await getTeams(await sessionCookieFor(5001n));

  // Then
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
  // 금지 필드는 응답 어디에도 없다.
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
});

it('ACTIVE ADMIN 도 통과한다', async () => {
  findUnique.mockResolvedValue({
    id: 'synthetic-admin',
    role: 'ADMIN',
    accountStatus: AccountStatus.ACTIVE,
  });
  listForStaff.mockResolvedValue([]);

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
    // Given
    findUnique.mockResolvedValue({ id: 'synthetic-user', role, accountStatus });

    // When
    const response = await getTeams(await sessionCookieFor(5003n));

    // Then
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
