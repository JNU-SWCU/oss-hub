import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import { AuthConfig } from '../../auth/auth.config';
import { AuthService } from '../../auth/service/auth.service';
import { AuthErrorCode } from '../../auth/domain/auth-error-code.enum';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { sessionCookieName } from '../../auth/domain/cookies';
import { issueSessionToken } from '../../auth/domain/session-token';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ProblemDetailFilter } from '../../common/controller/problem-detail.filter';
import { SystemErrorCode } from '../../common/system-error-code.enum';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { TeamsErrorCode } from '../domain/teams-error-code.enum';
import { ProgramTeamsController } from './program-teams.controller';
import type {
  ProgramTeamsRepository,
  TeamActorAuthority,
} from '../repository/program-teams.repository';
import type { TeamDeletionResult } from '../repository/program-team-deletion.repository';
import { ProgramTeamsService } from '../service/program-teams.service';
import { stubTeamDeletionRepository } from '../service/program-teams.service.test-support';

const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(7);
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const JOIN_CODE_SECRET = 'synthetic-program-teams-secret';
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

const DELETED_COUNTS = {
  applications: 1,
  members: 3,
  invitations: 2,
  submissions: 4,
  submissionEvents: 9,
  detachedRepositories: 1,
};

const DELETED_BODY = {
  teamId: TEAM_ID,
  deleted: true,
  deletedCounts: DELETED_COUNTS,
};

const INVALID_BODY = {
  expectedScope: { ...EXPECTED_SCOPE, members: -1 },
};

const STAFF_AUTHORITY: TeamActorAuthority = {
  id: 'synthetic-staff',
  isStaff: true,
};

const ADMIN_AUTHORITY: TeamActorAuthority = {
  id: 'synthetic-admin',
  isStaff: true,
};

const STUDENT_AUTHORITY: TeamActorAuthority = {
  id: 'synthetic-student',
  isStaff: false,
};

const DEACTIVATED_AUTHORITY: TeamActorAuthority | null = null;

function unauthenticatedProblem() {
  return {
    type: 'about:blank',
    title: 'UNAUTHORIZED',
    status: 401,
    detail: '로그인이 필요합니다.',
    instance: INSTANCE,
    code: AuthErrorCode.UNAUTHENTICATED,
  };
}

function originForbiddenProblem() {
  return {
    type: 'about:blank',
    title: 'FORBIDDEN',
    status: 403,
    detail: '허용되지 않은 Origin의 요청입니다.',
    instance: INSTANCE,
    code: AuthErrorCode.ORIGIN_FORBIDDEN,
  };
}

function deleteForbiddenProblem() {
  return {
    type: 'about:blank',
    title: 'FORBIDDEN',
    status: 403,
    detail: '교직원만 팀을 삭제할 수 있습니다.',
    instance: INSTANCE,
    code: TeamsErrorCode.TEAM_DELETE_FORBIDDEN,
  };
}

function validationProblem(detail: unknown = expect.any(String)) {
  return {
    type: 'about:blank',
    title: 'BAD_REQUEST',
    status: 400,
    detail,
    instance: INSTANCE,
    code: SystemErrorCode.VALIDATION_FAILED,
  };
}

const findActorAuthorityByGithubId = jest.fn();
const repositoryDeleteTeam = jest.fn<Promise<TeamDeletionResult>, unknown[]>();

const repository = {
  findActorAuthorityByGithubId,
} as unknown as ProgramTeamsRepository;

const service = new ProgramTeamsService(
  repository,
  loadRuntimeConfig({ TEAM_JOIN_CODE_SECRET: JOIN_CODE_SECRET }),
  { record: jest.fn() } as unknown as AuditLogService,
  stubTeamDeletionRepository({ deleteTeam: repositoryDeleteTeam }),
  { assertActiveStaff: jest.fn() },
);

const deleteForStaff = jest.fn(
  (...args: Parameters<ProgramTeamsService['deleteForStaff']>) =>
    service.deleteForStaff(...args),
);

const validRequestCells = [
  {
    role: 'anonymous',
    githubId: null,
    authority: null,
    status: 401,
    expected: unauthenticatedProblem(),
  },
  {
    role: 'STUDENT',
    githubId: 5101n,
    authority: STUDENT_AUTHORITY,
    status: 403,
    expected: deleteForbiddenProblem(),
  },
  {
    role: '비활성 STAFF',
    githubId: 5102n,
    authority: DEACTIVATED_AUTHORITY,
    status: 403,
    expected: deleteForbiddenProblem(),
  },
  {
    role: 'STAFF',
    githubId: 5103n,
    authority: STAFF_AUTHORITY,
    status: 200,
    expected: DELETED_BODY,
  },
  {
    role: 'ADMIN',
    githubId: 5104n,
    authority: ADMIN_AUTHORITY,
    status: 200,
    expected: DELETED_BODY,
  },
];

const responseMatrix = validRequestCells.flatMap((actor) =>
  [
    { origin: 'valid', header: allowedOrigin },
    { origin: 'foreign', header: 'http://evil.test' },
    { origin: 'missing', header: null },
  ].flatMap((origin) =>
    [
      { input: 'valid', body: { expectedScope: EXPECTED_SCOPE } },
      { input: 'invalid', body: INVALID_BODY },
    ].map((input) => {
      const expected =
        actor.githubId === null
          ? unauthenticatedProblem()
          : origin.origin !== 'valid'
            ? originForbiddenProblem()
            : input.input === 'invalid'
              ? validationProblem(
                  'expectedScope.members must not be less than 0',
                )
              : actor.expected;
      return {
        ...actor,
        ...origin,
        ...input,
        status: 'status' in expected ? expected.status : 200,
        expected,
      };
    }),
  ),
);

let application: INestApplication | undefined;
let baseUrl = '';

async function deleteTeam(
  cookie: string | null,
  body: unknown = { expectedScope: EXPECTED_SCOPE },
  origin: string | null = allowedOrigin,
): Promise<Response> {
  return fetch(`${baseUrl}${INSTANCE}`, {
    method: 'DELETE',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      ...(origin === null ? {} : { origin }),
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
  deleteForStaff.mockClear();
  findActorAuthorityByGithubId.mockReset();
  findActorAuthorityByGithubId.mockResolvedValue(STAFF_AUTHORITY);
  repositoryDeleteTeam.mockReset();
  repositoryDeleteTeam.mockResolvedValue({
    outcome: 'deleted',
    deletedCounts: DELETED_COUNTS,
  });
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('확인한 범위를 그대로 보내면 200 과 지운 수치를 받는다', async () => {
  const response = await deleteTeam(await sessionCookieFor(5001n));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    teamId: TEAM_ID,
    deleted: true,
    deletedCounts: DELETED_COUNTS,
  });
  expect(deleteForStaff).toHaveBeenCalledWith(
    5001n,
    PROGRAM_ID,
    TEAM_ID,
    EXPECTED_SCOPE,

    null,
  );
  expect(repositoryDeleteTeam).toHaveBeenCalledWith(
    PROGRAM_ID,
    TEAM_ID,
    EXPECTED_SCOPE,
    expect.any(Function),
    expect.any(Function),
  );
});

it('학생 토큰은 service 판정으로 403 TEAM_018 이 된다', async () => {
  findActorAuthorityByGithubId.mockResolvedValue(STUDENT_AUTHORITY);

  const response = await deleteTeam(await sessionCookieFor(5002n));

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual(deleteForbiddenProblem());
  expect(repositoryDeleteTeam).not.toHaveBeenCalled();
});

it('없는 팀·다른 프로그램의 팀은 구분 없이 404 TEAM_017 이다', async () => {
  repositoryDeleteTeam.mockResolvedValue({ outcome: 'not-found' });

  const response = await deleteTeam(await sessionCookieFor(5003n));

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({
    type: 'about:blank',
    title: 'NOT_FOUND',
    status: 404,
    detail: '팀을 찾을 수 없습니다.',
    instance: INSTANCE,
    code: TeamsErrorCode.TARGET_TEAM_NOT_FOUND,
  });
});

it('범위가 어긋나면 409 TEAM_019 와 현재 팀 범위를 함께 돌려준다', async () => {
  const currentTeamScopeCounts = { ...EXPECTED_SCOPE, submissions: 5 };
  repositoryDeleteTeam.mockResolvedValue({
    outcome: 'scope-changed',
    currentScopeCounts: currentTeamScopeCounts,
  });

  const response = await deleteTeam(await sessionCookieFor(5004n));

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    type: 'about:blank',
    title: 'CONFLICT',
    status: 409,
    detail: '확인 이후 팀의 내용이 바뀌었습니다. 다시 확인해 주세요.',
    instance: INSTANCE,
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
  await expect(response.json()).resolves.toEqual(validationProblem());
  expect(deleteForStaff).not.toHaveBeenCalled();
});

it('세션 쿠키가 없으면 401 이고 service 까지 가지 않는다', async () => {
  const response = await deleteTeam(null);

  expect(response.status).toBe(401);
  expect(deleteForStaff).not.toHaveBeenCalled();
});

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

it.each(responseMatrix)(
  '$role / $origin Origin / $input body 응답 계약을 유지한다',
  async ({ header, body, githubId, authority, status, expected }) => {
    findActorAuthorityByGithubId.mockResolvedValue(authority);

    const response = await deleteTeam(
      githubId === null ? null : await sessionCookieFor(githubId),
      body,
      header,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(expected);
    if (status !== 200) {
      expect(repositoryDeleteTeam).not.toHaveBeenCalled();
    }
    if (
      githubId === null ||
      header !== allowedOrigin ||
      body === INVALID_BODY
    ) {
      expect(deleteForStaff).not.toHaveBeenCalled();
      expect(findActorAuthorityByGithubId).not.toHaveBeenCalled();
    }
  },
);

it('본문이 잘못되어도 세션이 없으면 401 이 먼저다', async () => {
  const response = await deleteTeam(null, INVALID_BODY);

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual(unauthenticatedProblem());
  expect(deleteForStaff).not.toHaveBeenCalled();
});

it.each([
  { origin: '다른 origin', header: 'http://evil.test' },
  { origin: 'origin 없음', header: null },
])(
  '본문이 잘못되어도 $origin 이면 403 AUT_002 가 먼저다',
  async ({ header }) => {
    const response = await deleteTeam(
      await sessionCookieFor(5103n),
      INVALID_BODY,
      header,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(originForbiddenProblem());
    expect(deleteForStaff).not.toHaveBeenCalled();
  },
);

it('본문이 잘못되면 교직원이 아닌 계정도 400 SYS_003 을 먼저 받는다', async () => {
  findActorAuthorityByGithubId.mockResolvedValue(STUDENT_AUTHORITY);

  const response = await deleteTeam(
    await sessionCookieFor(5101n),
    INVALID_BODY,
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual(validationProblem());
  expect(deleteForStaff).not.toHaveBeenCalled();
  expect(findActorAuthorityByGithubId).not.toHaveBeenCalled();
});
