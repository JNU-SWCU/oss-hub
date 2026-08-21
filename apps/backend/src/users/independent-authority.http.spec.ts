import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, MemberKind, Role } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminAccessActor } from './admin-access.repository.types';
import {
  ADMIN_ACCESS_COMMANDS,
  STAFF_ACCESS_COMMANDS,
} from './domain/independent-authority';
import { IndependentAuthorityController } from './independent-authority.controller';
import {
  IndependentAuthorityRepository,
  type IndependentAuthorityRepositoryPort,
  type IndependentAuthorityTransactionStore,
  type IndependentAuthorityUserRecord,
} from './independent-authority.repository';
import { IndependentAuthorityService } from './independent-authority.service';
import type { IndependentAuthorityTransition } from './independent-authority-transition';

const githubId = 9_700_400_001n;
const sessionSecret = new Uint8Array(32).fill(23);
const allowedOrigin = 'http://frontend.test';

class HttpAuthorityStore
  implements
    IndependentAuthorityRepositoryPort,
    IndependentAuthorityTransactionStore
{
  readonly auditLogWriter = new PrismaService();
  actor: AdminAccessActor = adminActor();
  target: IndependentAuthorityUserRecord = targetUser();
  activeAdminCount = 2;
  updates: IndependentAuthorityTransition[] = [];

  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  findActorByGithubId(): Promise<AdminAccessActor> {
    return Promise.resolve(this.actor);
  }

  lockActiveAdmins(): Promise<number> {
    return Promise.resolve(this.activeAdminCount);
  }

  findUserForUpdate(): Promise<IndependentAuthorityUserRecord> {
    return Promise.resolve(this.target);
  }

  updateAuthority(
    _userId: string,
    transition: IndependentAuthorityTransition,
  ): Promise<void> {
    this.updates.push(transition);
    this.target = { ...this.target, ...transition };
    return Promise.resolve();
  }

  reset(): void {
    this.actor = adminActor();
    this.target = targetUser();
    this.activeAdminCount = 2;
    this.updates = [];
  }
}

const store = new HttpAuthorityStore();

describe('independent authority HTTP contracts', () => {
  let application: INestApplication;
  let baseUrl = '';
  let cookie = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IndependentAuthorityController],
      providers: [
        IndependentAuthorityService,
        SessionGuard,
        OriginGuard,
        { provide: IndependentAuthorityRepository, useValue: store },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: AuthService,
          useValue: { getMe: jest.fn().mockResolvedValue({ id: 'actor' }) },
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
    cookie = `${sessionCookieName(false)}=${await issueSessionToken(
      sessionSecret,
      githubId,
    )}`;
  });

  beforeEach(() => store.reset());
  afterAll(async () => application.close());

  it.each([
    ['staff-access', STAFF_ACCESS_COMMANDS.REVOKE, false, true, Role.ADMIN],
    ['admin-access', ADMIN_ACCESS_COMMANDS.REVOKE, true, false, Role.STAFF],
  ] as const)(
    'preserves the other authority through PATCH /users/:id/%s',
    async (path, command, hasStaffAccess, hasAdminAccess, role) => {
      store.target = targetUser({
        role: Role.ADMIN,
        hasStaffAccess: true,
        hasAdminAccess: true,
      });

      const response = await request(path, command, cookie, allowedOrigin);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: 'target',
        role,
        memberKind: MemberKind.STUDENT,
        hasStaffAccess,
        hasAdminAccess,
      });
    },
  );

  it('treats a same-state command as an idempotent HTTP success', async () => {
    store.target = targetUser({ role: Role.ADMIN, hasAdminAccess: true });

    const response = await request(
      'admin-access',
      ADMIN_ACCESS_COMMANDS.GRANT,
      cookie,
      allowedOrigin,
    );

    expect(response.status).toBe(200);
    expect(store.updates).toHaveLength(0);
  });

  it('denies a non-admin actor', async () => {
    store.actor = { ...adminActor(), role: Role.STAFF };
    const response = await request(
      'staff-access',
      STAFF_ACCESS_COMMANDS.GRANT,
      cookie,
      allowedOrigin,
    );

    expect(response.status).toBe(403);
    expect(store.updates).toHaveLength(0);
  });

  it('denies revoking the final active admin', async () => {
    store.activeAdminCount = 1;
    store.target = targetUser({ role: Role.ADMIN, hasAdminAccess: true });
    const response = await request(
      'admin-access',
      ADMIN_ACCESS_COMMANDS.REVOKE,
      cookie,
      allowedOrigin,
    );

    expect(response.status).toBe(409);
    expect(store.updates).toHaveLength(0);
  });

  it('denies unauthenticated and untrusted-origin mutations', async () => {
    const unauthenticated = await request(
      'staff-access',
      STAFF_ACCESS_COMMANDS.GRANT,
      undefined,
      allowedOrigin,
    );
    const untrusted = await request(
      'admin-access',
      ADMIN_ACCESS_COMMANDS.GRANT,
      cookie,
      'http://untrusted.test',
    );

    expect([unauthenticated.status, untrusted.status]).toEqual([401, 403]);
    expect(store.updates).toHaveLength(0);
  });

  it('rejects an exclusive legacy role command', async () => {
    const response = await request(
      'staff-access',
      'SET_ROLE_STAFF',
      cookie,
      allowedOrigin,
    );
    expect(response.status).toBe(400);
  });

  function request(
    path: string,
    command: string,
    sessionCookie: string | undefined,
    origin: string,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/users/target/${path}`, {
      method: 'PATCH',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        origin,
        ...(sessionCookie ? { cookie: sessionCookie } : {}),
      },
      body: JSON.stringify({ command }),
    });
  }
});

function adminActor(): AdminAccessActor {
  return {
    id: 'actor',
    githubId,
    githubLogin: 'synthetic-admin',
    name: '합성 관리자',
    role: Role.ADMIN,
    accountStatus: AccountStatus.ACTIVE,
  };
}

function targetUser(
  overrides: Partial<IndependentAuthorityUserRecord> = {},
): IndependentAuthorityUserRecord {
  return {
    id: 'target',
    githubId: 9_700_400_002n,
    githubLogin: 'synthetic-target',
    name: '합성 학생',
    role: Role.STUDENT,
    selectedRole: Role.STUDENT,
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: null,
    ...overrides,
  };
}
