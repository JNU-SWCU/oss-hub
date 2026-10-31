import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, MemberKind } from '@prisma/client';
import { AuditLogService } from '../platform/audit-log.service';
import { AuthConfig } from '../platform/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../platform/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { UserAccessController } from '../admin/user-access.controller';
import {
  IndependentAuthorityRepository,
  type IndependentAuthorityRepositoryPort,
  type IndependentAuthorityTransactionStore,
  type IndependentAuthorityTransition,
} from './independent-authority.repository';
import { ADMIN_ACCESS_COMMANDS } from './admin-access-query.config';
import { IndependentAuthorityService } from './independent-authority.service';
import {
  type AdminAccessActor,
  type AdminAccessInsertedRequest,
  type AdminAccessRevokedRequestInsert,
} from './admin-access-read.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import type { AdminAccessUserRow } from './admin-access-read.repository';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { UserProfileService } from './user-profile.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { GLOBAL_AUTHENTICATION_GUARD_PROVIDERS } from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

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
  target: AdminAccessUserRow = targetUser();
  activeAdminCount = 2;
  updates: IndependentAuthorityTransition[] = [];
  revokedInserts: AdminAccessRevokedRequestInsert[] = [];

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

  findUserForUpdate(): Promise<AdminAccessUserRow> {
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

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    this.revokedInserts.push(input);
    return Promise.resolve({ id: `revoked-${this.revokedInserts.length}` });
  }

  reset(): void {
    this.actor = adminActor();
    this.target = targetUser();
    this.activeAdminCount = 2;
    this.updates = [];
    this.revokedInserts = [];
  }
}

const store = new HttpAuthorityStore();

describe('independent authority HTTP contracts', () => {
  let application: INestApplication;
  let baseUrl = '';
  let cookie = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserAccessController],
      providers: [
        ...STATELESS_PROVIDERS,
        AdminAccessMutationService,
        UserProfileService,
        IndependentAuthorityService,
        AuditLogMetadataService,
        ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
        OriginGuard,
        { provide: IndependentAuthorityRepository, useValue: store },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: AuthService,
          useValue: {
            getMe: jest
              .fn()
              .mockResolvedValue({ id: 'actor', sessionVersion: 0 }),
          },
        },
        {
          provide: AuthConfig,
          useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
        },
      ],
    })
      .useMocker((token) => (token === Function ? undefined : {}))
      .compile();
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
    cookie = `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(
      sessionSecret,
      githubId,
      0,
    )}`;
  });

  beforeEach(() => store.reset());
  afterAll(async () => application.close());

  it.each([
    ['admin-access', ADMIN_ACCESS_COMMANDS.REVOKE, true, false, 'STAFF'],
  ] as const)(
    'preserves the other authority through PATCH /users/:id/%s',
    async (path, command, hasStaffAccess, hasAdminAccess, role) => {
      store.target = targetUser({
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

  it('rejects a same-state command as a stale-view conflict', async () => {
    store.target = targetUser({ hasAdminAccess: true });

    const response = await request(
      'admin-access',
      ADMIN_ACCESS_COMMANDS.GRANT,
      cookie,
      allowedOrigin,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ROL_013',
      currentAccess: { role: 'ADMIN' },
    });
    expect(store.updates).toHaveLength(0);
  });

  it('denies a non-admin actor', async () => {
    store.actor = {
      ...adminActor(),
      hasAdminAccess: false,
    };
    const response = await request(
      'admin-access',
      ADMIN_ACCESS_COMMANDS.GRANT,
      cookie,
      allowedOrigin,
    );

    expect(response.status).toBe(403);
    expect(store.updates).toHaveLength(0);
  });

  it('denies revoking the final active admin', async () => {
    store.activeAdminCount = 1;
    store.target = targetUser({ hasAdminAccess: true });
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
      'admin-access',
      ADMIN_ACCESS_COMMANDS.GRANT,
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
      'admin-access',
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
    hasStaffAccess: true,
    hasAdminAccess: true,
    accountStatus: AccountStatus.ACTIVE,
  };
}

function targetUser(
  overrides: Partial<AdminAccessUserRow> = {},
): AdminAccessUserRow {
  return {
    id: 'target',
    githubId: 9_700_400_002n,
    githubLogin: 'synthetic-target',
    name: null,
    studentId: null,
    department: null,
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    pendingRequest: null,
    lastLoginAt: null,
    ...overrides,
  };
}
