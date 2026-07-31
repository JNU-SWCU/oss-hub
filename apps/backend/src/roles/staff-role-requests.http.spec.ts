import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { StaffRoleRequestsController } from './staff-role-requests.controller';
import { StaffRoleRequestsService } from './staff-role-requests.service';
import {
  ADMIN_GITHUB_ID,
  createAuditLogService,
  InMemoryStaffRoleRequestsRepository,
  pendingRequest,
  STAFF_GITHUB_ID,
} from './staff-role-requests.service.spec-support';

/**
 * `staff-role-requests.controller.spec.ts`/`.service.spec.ts`는 컨트롤러를 직접 생성하거나
 * guard 메타데이터만 리플렉션으로 확인해 실제 SessionGuard/OriginGuard가 요청을 거부하는지
 * 증명하지 않는다. 이 파일은 실제 Nest 앱 + 실 guard + 실 HTTP 요청으로만 그 계약을 고정한다.
 */

const sessionSecret = new Uint8Array(32).fill(17);
const allowedOrigin = 'http://frontend.test';
const STUDENT_GITHUB_ID = 9_141_300_003n;

class RepositoryWithStudentActor extends InMemoryStaffRoleRequestsRepository {
  override findUserByGithubId(
    githubId: bigint,
  ): ReturnType<InMemoryStaffRoleRequestsRepository['findUserByGithubId']> {
    if (githubId === STUDENT_GITHUB_ID) {
      return Promise.resolve({
        id: 'synthetic-student-actor',
        name: '합성 학생',
        githubLogin: 'synthetic-student-actor',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
      });
    }
    return super.findUserByGithubId(githubId);
  }
}

interface Harness {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly auditLog: jest.Mocked<AuditLogService>;
}

async function bootHarness(request = pendingRequest()): Promise<Harness> {
  const repository = new RepositoryWithStudentActor(request);
  const auditLog = createAuditLogService();
  const service = new StaffRoleRequestsService(repository, auditLog);

  const moduleRef = await Test.createTestingModule({
    controllers: [StaffRoleRequestsController],
    providers: [
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
      { provide: StaffRoleRequestsService, useValue: service },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailFilter());
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  return { app, baseUrl, auditLog };
}

async function cookie(githubId: bigint): Promise<string> {
  return `${sessionCookieName(false)}=${await issueSessionToken(
    sessionSecret,
    githubId,
  )}`;
}

function patchBody(action: string): string {
  return JSON.stringify({ action });
}

describe('StaffRoleRequestsController HTTP', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness.app.close();
  });

  it('익명 GET /api/v1/role-requests 요청을 401로 차단한다', async () => {
    harness = await bootHarness();

    const response = await fetch(`${harness.baseUrl}/api/v1/role-requests`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUT_003' });
  });

  it.each([
    ['학생', STUDENT_GITHUB_ID],
    ['교직원(본인)', STAFF_GITHUB_ID],
  ] as const)(
    '%s GET /api/v1/role-requests 요청을 403으로 차단한다',
    async (_, id) => {
      harness = await bootHarness();

      const response = await fetch(`${harness.baseUrl}/api/v1/role-requests`, {
        headers: { cookie: await cookie(id) },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'ROL_004' });
    },
  );

  it('ADMIN GET /api/v1/role-requests 요청은 실 guard를 통과해 PENDING 목록을 반환한다', async () => {
    harness = await bootHarness();

    const response = await fetch(`${harness.baseUrl}/api/v1/role-requests`, {
      headers: { cookie: await cookie(ADMIN_GITHUB_ID) },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          githubLogin: 'synthetic-staff',
          status: RoleRequestStatus.PENDING,
        }),
      ],
    });
  });

  it('익명 PATCH /api/v1/role-requests/:id 요청을 401로 차단한다', async () => {
    harness = await bootHarness();

    const response = await fetch(
      `${harness.baseUrl}/api/v1/role-requests/synthetic-request`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: patchBody('APPROVE'),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUT_003' });
    expect(harness.auditLog.record.mock.calls).toHaveLength(0);
  });

  it('학생 PATCH /api/v1/role-requests/:id 요청을 403으로 차단한다', async () => {
    harness = await bootHarness();

    const response = await fetch(
      `${harness.baseUrl}/api/v1/role-requests/synthetic-request`,
      {
        method: 'PATCH',
        headers: {
          cookie: await cookie(STUDENT_GITHUB_ID),
          'content-type': 'application/json',
        },
        body: patchBody('APPROVE'),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'ROL_004' });
    expect(harness.auditLog.record.mock.calls).toHaveLength(0);
  });

  it('ADMIN이 실 HTTP 경로로 PENDING 요청을 승인하면 STAFF 역할을 부여하고 감사 로그를 정확히 한 번 남긴다', async () => {
    harness = await bootHarness();

    const response = await fetch(
      `${harness.baseUrl}/api/v1/role-requests/synthetic-request`,
      {
        method: 'PATCH',
        headers: {
          cookie: await cookie(ADMIN_GITHUB_ID),
          'content-type': 'application/json',
        },
        body: patchBody('APPROVE'),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: RoleRequestStatus.APPROVED,
      decidedBy: 'synthetic-admin',
    });
    expect(harness.auditLog.record.mock.calls).toHaveLength(1);
  });

  it('이미 승인된 요청을 실 HTTP 경로로 다시 승인하면 409/ROL_007을 반환하고 감사 로그를 추가로 남기지 않는다', async () => {
    harness = await bootHarness();
    const cookieHeader = { cookie: await cookie(ADMIN_GITHUB_ID) };

    const first = await fetch(
      `${harness.baseUrl}/api/v1/role-requests/synthetic-request`,
      {
        method: 'PATCH',
        headers: { ...cookieHeader, 'content-type': 'application/json' },
        body: patchBody('APPROVE'),
      },
    );
    expect(first.status).toBe(200);

    const second = await fetch(
      `${harness.baseUrl}/api/v1/role-requests/synthetic-request`,
      {
        method: 'PATCH',
        headers: { ...cookieHeader, 'content-type': 'application/json' },
        body: patchBody('APPROVE'),
      },
    );

    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: 'ROL_007' });
    expect(harness.auditLog.record.mock.calls).toHaveLength(1);
  });

  it('PENDING 요청을 실 HTTP 경로로 즉시 회수하면 상태 불일치로 409/ROL_007을 반환한다', async () => {
    harness = await bootHarness();

    const response = await fetch(
      `${harness.baseUrl}/api/v1/role-requests/synthetic-request`,
      {
        method: 'PATCH',
        headers: {
          cookie: await cookie(ADMIN_GITHUB_ID),
          'content-type': 'application/json',
        },
        body: patchBody('REVOKE'),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ROL_007' });
    expect(harness.auditLog.record.mock.calls).toHaveLength(0);
  });
});
