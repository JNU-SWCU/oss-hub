import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { AdminUsersController } from './admin-users.controller';
import {
  AdminUsersRepository,
  type AdminUserRecord,
  type AdminUsersRepositoryPort,
} from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';

const sessionSecret = new Uint8Array(32).fill(13);
const allowedOrigin = 'http://frontend.test';
const ADMIN_GITHUB_ID = 9_131_200_001n;
const STAFF_GITHUB_ID = 9_131_200_002n;
const STUDENT_GITHUB_ID = 9_131_200_003n;

const users: readonly AdminUserRecord[] = [
  {
    id: 'synthetic-http-admin',
    githubId: ADMIN_GITHUB_ID,
    githubLogin: 'synthetic-http-admin',
    name: '합성 관리자',
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: 'synthetic-http-staff',
    githubId: STAFF_GITHUB_ID,
    githubLogin: 'synthetic-http-staff',
    name: '합성 교직원',
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
  },
  {
    id: 'synthetic-http-student',
    githubId: STUDENT_GITHUB_ID,
    githubLogin: 'synthetic-http-student',
    name: '합성 학생',
    role: Role.STUDENT,
    accountStatus: AccountStatus.ACTIVE,
  },
];

const repository: AdminUsersRepositoryPort = {
  findUserByGithubId: (githubId) =>
    Promise.resolve(users.find((user) => user.githubId === githubId) ?? null),
  list: () => Promise.resolve(users),
  withTransaction: () => {
    throw new Error('목록 HTTP 검증에서 트랜잭션을 열면 안 됩니다.');
  },
};

let application: INestApplication | undefined;
let baseUrl = '';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminUsersController],
    providers: [
      AdminUsersService,
      SessionGuard,
      OriginGuard,
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ id: 'synthetic' }) },
      },
      { provide: AdminUsersRepository, useValue: repository },
      { provide: AuditLogService, useValue: { record: jest.fn() } },
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

afterAll(async () => {
  await application?.close();
});

async function cookie(githubId: bigint): Promise<string> {
  return `${sessionCookieName(false)}=${await issueSessionToken(
    sessionSecret,
    githubId,
  )}`;
}

it('익명 GET /api/v1/users 요청을 401로 차단한다', async () => {
  const response = await fetch(`${baseUrl}/api/v1/users`);

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: 'AUT_003' });
});

it.each([
  ['학생', STUDENT_GITHUB_ID],
  ['교직원', STAFF_GITHUB_ID],
] as const)('%s GET /api/v1/users 요청을 403으로 차단한다', async (_, id) => {
  const response = await fetch(`${baseUrl}/api/v1/users`, {
    headers: { cookie: await cookie(id) },
  });

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ code: 'ROL_004' });
});

it('ADMIN GET /api/v1/users 요청만 목록을 반환한다', async () => {
  const response = await fetch(`${baseUrl}/api/v1/users`, {
    headers: { cookie: await cookie(ADMIN_GITHUB_ID) },
  });

  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toEqual([
    expect.objectContaining({
      githubLogin: 'synthetic-http-admin',
      isSelf: true,
    }),
    expect.objectContaining({
      githubLogin: 'synthetic-http-staff',
      isSelf: false,
    }),
    expect.objectContaining({
      githubLogin: 'synthetic-http-student',
      isSelf: false,
    }),
  ]);
});
