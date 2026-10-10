import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import { AuthConfig } from '../../auth/auth.config';
import { AuthService } from '../../auth/service/auth.service';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { sessionCookieName } from '../../auth/domain/cookies';
import { issueSessionToken } from '../../auth/domain/session-token';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ProblemDetailFilter } from '../../common/controller/problem-detail.filter';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { TeamsErrorCode } from '../domain/teams-error-code.enum';
import { ProgramTeamsController } from './program-teams.controller';
import type {
  ProgramTeamsRepository,
  StaffTeamDetailRecord,
} from '../repository/program-teams.repository';
import { ProgramTeamsService } from '../service/program-teams.service';
import { stubTeamDeletionRepository } from '../service/program-teams.service.test-support';

const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(7);
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const JOIN_CODE_SECRET = 'synthetic-staff-detail-secret';
const DETAIL_INSTANCE = `/api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}`;

const DELETION_SCOPE = {
  applications: 1,
  members: 1,
  invitations: 0,
  submissions: 2,
  submissionEvents: 3,
  detachedRepositories: 1,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
};

const STAFF_TEAM_DETAIL: StaffTeamDetailRecord = {
  id: TEAM_ID,
  name: '오픈소스팀',
  leaderId: 'user-a',
  members: [{ userId: 'user-a', nickname: 'login-a', name: '가나다' }],
  application: null,
  repositoryContributions: null,
  repositoryUrlHistory: { items: [], nextCursor: null },
};

const STAFF_USER = {
  id: 'synthetic-staff',
  hasStaffAccess: true,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};

const findStaffTeamDetail = jest.fn();
const readScopeCounts = jest.fn();
const findUnique = jest.fn();

const service = new ProgramTeamsService(
  { findStaffTeamDetail } as unknown as ProgramTeamsRepository,
  loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
  { record: jest.fn() } as unknown as AuditLogService,
  stubTeamDeletionRepository({ readScopeCounts }),
  new UsersAuthorityService({ findActorByGithubId: findUnique }),
);

const getForStaff = jest.fn(
  (...args: Parameters<ProgramTeamsService['getForStaff']>) =>
    service.getForStaff(...args),
);

let application: INestApplication | undefined;
let baseUrl = '';

async function getTeamDetail(cookie: string | null): Promise<Response> {
  return fetch(`${baseUrl}${DETAIL_INSTANCE}`, {
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
  getForStaff.mockClear();
  findUnique.mockReset();
  findStaffTeamDetail.mockReset();
  findStaffTeamDetail.mockResolvedValue(STAFF_TEAM_DETAIL);
  readScopeCounts.mockReset();
  readScopeCounts.mockResolvedValue(DELETION_SCOPE);
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('ACTIVE STAFF 는 팀 상세를 200 으로 받는다', async () => {
  findUnique.mockResolvedValue(STAFF_USER);

  const response = await getTeamDetail(await sessionCookieFor(5001n));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    teamId: TEAM_ID,
    name: '오픈소스팀',
    memberCount: 1,
    members: [
      { userId: 'user-a', name: '가나다', nickname: 'login-a', isLeader: true },
    ],
    application: null,
    repositoryContributions: null,
    repositoryUrlHistory: { items: [], nextCursor: null },
    deletionScope: DELETION_SCOPE,
  });
  expect(getForStaff).toHaveBeenCalledWith(5001n, PROGRAM_ID, TEAM_ID);
  expect(findStaffTeamDetail).toHaveBeenCalledWith(PROGRAM_ID, TEAM_ID);
  expect(readScopeCounts).toHaveBeenCalledWith(TEAM_ID);
});

it.each([
  ['STUDENT', 'STUDENT', AccountStatus.ACTIVE],
  ['역할 미지정', null, AccountStatus.ACTIVE],
  ['비활성 STAFF', 'STAFF', AccountStatus.DEACTIVATED],
])(
  '%s 계정은 403 TEAM_003 으로 막히고 팀 repository 를 호출하지 않는다',
  async (_label, role, accountStatus) => {
    findUnique.mockResolvedValue({ id: 'synthetic-user', role, accountStatus });

    const response = await getTeamDetail(await sessionCookieFor(5002n));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      type: 'about:blank',
      status: 403,
      code: TeamsErrorCode.STAFF_ONLY,
      instance: DETAIL_INSTANCE,
    });
    expect(findStaffTeamDetail).not.toHaveBeenCalled();
    expect(readScopeCounts).not.toHaveBeenCalled();
  },
);

it('없는 팀·다른 프로그램의 팀은 구분 없이 404 TEAM_010 이다', async () => {
  findUnique.mockResolvedValue(STAFF_USER);
  findStaffTeamDetail.mockResolvedValue(null);

  const response = await getTeamDetail(await sessionCookieFor(5003n));

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    type: 'about:blank',
    status: 404,
    code: TeamsErrorCode.TEAM_NOT_FOUND,
    instance: DETAIL_INSTANCE,
  });
  expect(findStaffTeamDetail).toHaveBeenCalledWith(PROGRAM_ID, TEAM_ID);
  expect(readScopeCounts).not.toHaveBeenCalled();
});

it('세션 쿠키가 없으면 401 이고 권한 조회까지 가지 않는다', async () => {
  const response = await getTeamDetail(null);

  expect(response.status).toBe(401);
  expect(findUnique).not.toHaveBeenCalled();
  expect(getForStaff).not.toHaveBeenCalled();
  expect(findStaffTeamDetail).not.toHaveBeenCalled();
});

it('세션 쿠키가 위조되면 401 이다', async () => {
  const response = await getTeamDetail(
    `${sessionCookieName(false)}=not-a-token`,
  );

  expect(response.status).toBe(401);
  expect(getForStaff).not.toHaveBeenCalled();
  expect(findStaffTeamDetail).not.toHaveBeenCalled();
});
