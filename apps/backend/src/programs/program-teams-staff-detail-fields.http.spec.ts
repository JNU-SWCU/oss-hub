import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramTeamsController } from './controller/program-teams.controller';
import { ProgramTeamsStaffGuard } from './program-teams-staff.guard';
import { ProgramTeamsService } from './service/program-teams.service';

/**
 * 교직원 전용 팀 상세(GET /api/v1/programs/:programId/teams/:teamId, #874) 응답의
 * 필드 allowlist 전용 테스트 — 403/404/service-logic 은
 * `program-teams-staff-detail.http.spec.ts` 로 분리했다(이 저장소는 두 관심사를
 * 한 파일에 섞은 전례가 없다).
 *
 * ⚠ 이 응답은 `repository`(url·visibility)를 **의도적으로 포함**한다 — 같은
 * 교직원이 신청 목록/상세(`ApplicationListItemResponseDto.repository`)에서 이미
 * 보는 값이고, 팀 상세가 저장소 상태까지 한 요청으로 끝내야 한다는 이슈 요구
 * 때문이다(`team-detail-response.dto.ts` 주석 참고). 그래서 아래 금지어 목록에는
 * `repository`/`url`을 넣지 않는다 — `listStaffTeams`(팀 목록) 쪽 forbidden-field
 * 테스트와 의도적으로 다르다.
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

it('금지 필드(학번·학과·연락처·이메일·참여코드)는 신청·저장소가 있어도 응답에 없다', async () => {
  // Given
  findUnique.mockResolvedValue({
    id: 'synthetic-staff',
    role: Role.STAFF,
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

  // When
  const response = await getTeamDetail(await sessionCookieFor(6001n));

  // Then
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
  // repository.url 은 의도적으로 실린다 — 저장소 상태 확인에 필요하다.
  expect(serialized).toContain('synthetic-repo');
});

it('신청이 없어도(application: null) 금지 필드가 없다', async () => {
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
