import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/service/auth.service';
import { OriginGuard } from '../auth/controller/origin.guard';
import { sessionCookieName } from '../auth/domain/cookies';
import { issueSessionToken } from '../auth/domain/session-token';
import { SessionGuard } from '../auth/controller/session.guard';
import { ProblemDetailFilter } from '../common/controller/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import { ProgramTeamsService } from './service/program-teams.service';

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
  const token = await issueSessionToken(sessionSecret, githubId, 0);
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
  getForStaff.mockReset();
  findUnique.mockReset();
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('금지 필드(학번·학과·연락처·이메일·참여코드)는 신청·저장소가 있어도 응답에 없다', async () => {
  findUnique.mockResolvedValue({
    id: 'synthetic-staff',
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });
  getForStaff.mockResolvedValue({
    teamId: TEAM_ID,
    name: '오픈소스팀',
    memberCount: 2,
    members: [
      { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
      { userId: 'user-b', name: null, nickname: 'login-b', isLeader: false },
    ],
    application: {
      id: 'application-1',
      status: 'APPROVED',
      repository: {
        url: 'https://github.com/synthetic-org/synthetic-repo',
        visibility: 'PRIVATE',
      },
      repositoryProvisioning: {
        enabled: true,
        jobStatus: 'SUCCEEDED',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        safeErrorClass: null,
      },
    },
  });

  const response = await getTeamDetail(await sessionCookieFor(6001n));

  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'studentId',
    'department',
    'phone',
    'email',
    'joinCode',
    'joinCodeDigest',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }

  expect(serialized).toContain('synthetic-repo');
});

it('신청이 없어도(application: null) 금지 필드가 없다', async () => {
  findUnique.mockResolvedValue({
    id: 'synthetic-staff',
    hasStaffAccess: true,
    hasAdminAccess: false,
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

  const response = await getTeamDetail(await sessionCookieFor(6002n));

  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'studentId',
    'department',
    'phone',
    'email',
    'joinCode',
    'joinCodeDigest',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
});
