import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import { AuditLogService } from '../audit-log/service/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/service/auth.service';
import { AuthenticationGuard } from '../auth/controller/authentication.guard';
import { sessionCookieName } from '../auth/domain/cookies';
import { issueSessionToken } from '../auth/domain/session-token';
import { ProblemDetailFilter } from '../common/controller/problem-detail.filter';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminAccessActor } from './admin-access.repository.types';
import type {
  MemberKindProfileUpdate,
  MemberKindRepositoryPort,
  MemberKindTargetRecord,
  MemberKindTransactionStore,
} from './member-kind.repository';
import { MemberKindRepository } from './member-kind.repository';
import { UsersModule } from './users.module';

const ADMIN_GITHUB_ID = 9_700_600_001n;
const sessionSecret = new Uint8Array(32).fill(41);
const allowedOrigin = 'http://frontend.test';

class HttpMemberKindRepository
  implements MemberKindRepositoryPort, MemberKindTransactionStore
{
  readonly auditLogWriter = new PrismaService();
  actor: AdminAccessActor = adminActor();
  target: MemberKindTargetRecord = studentTarget();
  readonly updates: MemberKindProfileUpdate[] = [];

  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }

  lockActiveAdmins(): Promise<void> {
    return Promise.resolve();
  }

  findActorByGithubId(): Promise<AdminAccessActor> {
    return Promise.resolve(this.actor);
  }

  findTargetForUpdate(): Promise<MemberKindTargetRecord> {
    return Promise.resolve(this.target);
  }

  updateMemberKind(
    _userId: string,
    hasStaffAccess: boolean,
    selectedMemberKind: MemberKind,
    profilePatch: MemberKindProfileUpdate,
  ): Promise<'updated'> {
    this.updates.push(profilePatch);
    this.target = {
      ...this.target,
      selectedMemberKind,
      memberKind: selectedMemberKind,
      hasStaffAccess,
      role: this.target.hasAdminAccess
        ? 'ADMIN'
        : hasStaffAccess
          ? 'STAFF'
          : selectedMemberKind === MemberKind.STUDENT
            ? 'STUDENT'
            : null,
      profile: this.target.profile
        ? { ...this.target.profile, ...profilePatch }
        : null,
    };
    return Promise.resolve('updated');
  }

  insertRevokedRequest(): Promise<{ readonly id: string }> {
    return Promise.resolve({ id: 'synthetic-revoked' });
  }

  reset(): void {
    this.actor = adminActor();
    this.target = studentTarget();
    this.updates.length = 0;
  }
}

describe('PATCH /users/:id/member-kind HTTP contract', () => {
  const repository = new HttpMemberKindRepository();
  const audit = { record: jest.fn().mockResolvedValue({}) };
  let application: INestApplication;
  let baseUrl = '';

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [PrismaModule, UsersModule],
    });

    moduleBuilder.overrideProvider(PrismaService).useValue({});
    moduleBuilder.overrideProvider(MemberKindRepository).useValue(repository);
    moduleBuilder.overrideProvider(AuditLogService).useValue(audit);
    moduleBuilder.overrideProvider(AuthConfig).useValue({
      sessionSecret,
      allowedOrigin,
      useSecureCookies: false,
    });
    moduleBuilder.overrideProvider(AuthService).useValue({
      getMe: jest.fn().mockResolvedValue({ id: 'actor', sessionVersion: 0 }),
    });
    moduleBuilder.overrideGuard(AuthenticationGuard).useValue({
      canActivate: () => true,
    });
    application = (await moduleBuilder.compile()).createNestApplication();
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
    repository.reset();
    audit.record.mockClear();
  });

  afterAll(async () => {
    await application.close();
  });

  it('returns the independent authority result and normalizes the staff number', async () => {
    const response = await request({
      memberKind: 'STAFF',
      expectedMemberKind: 'STUDENT',
      expectedHasStaffAccess: false,
      staffNumber: ' 직원-A7 ',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'target',
      role: 'STAFF',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    });
    expect(repository.target.profile).toMatchObject({
      studentId: '123456',
      staffNumber: '직원-A7',
    });
  });

  it('rejects invalid payload fields at the HTTP validation boundary', async () => {
    const response = await request({
      memberKind: 'STAFF',
      expectedMemberKind: 'STUDENT',
      expectedHasStaffAccess: false,
      staffNumber: 'x'.repeat(101),
    });

    await expectProblem(response, 400, 'SYS_003');
    expect(repository.updates).toHaveLength(0);
  });

  it('rejects anonymous and non-admin actors before changing state', async () => {
    const anonymous = await request(validStaffBody(), null);
    await expectProblem(anonymous, 401, 'AUT_003');

    repository.actor = adminActor({
      hasAdminAccess: false,
      hasStaffAccess: true,
      role: 'STAFF',
    });
    const nonAdmin = await request(validStaffBody());
    await expectProblem(nonAdmin, 403, 'ROL_004');
    expect(repository.updates).toHaveLength(0);
  });

  it.each([
    ['missing canonical profile', () => missingProfileTarget(), 'USR_002'],
    ['pending request', () => pendingTarget(), 'ROL_015'],
    ['stale expected state', () => studentTarget(), 'ROL_013'],
  ] as const)(
    'rejects %s with the public problem contract',
    async (_label, target, code) => {
      repository.target = target();
      const body =
        code === 'ROL_013'
          ? {
              memberKind: 'STAFF',
              expectedMemberKind: 'STAFF',
              expectedHasStaffAccess: true,
            }
          : validStaffBody();

      const response = await request(body);

      await expectProblem(response, 409, code);
      expect(repository.updates).toHaveLength(0);
    },
  );

  async function request(
    body: Readonly<Record<string, unknown>>,
    githubId: bigint | null = ADMIN_GITHUB_ID,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      origin: allowedOrigin,
      'content-type': 'application/json',
    };
    if (githubId !== null) {
      headers.cookie = `${sessionCookieName(false)}=${await issueSessionToken(
        sessionSecret,
        githubId,
        0,
      )}`;
    }
    return fetch(`${baseUrl}/api/v1/users/target/member-kind`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
  }

  async function expectProblem(
    response: Response,
    status: number,
    code: string,
  ): Promise<void> {
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    );
    await expect(response.json()).resolves.toMatchObject({ status, code });
  }
});

function validStaffBody(): Readonly<Record<string, unknown>> {
  return {
    memberKind: 'STAFF',
    expectedMemberKind: 'STUDENT',
    expectedHasStaffAccess: false,
  };
}

function adminActor(
  overrides: Partial<AdminAccessActor> = {},
): AdminAccessActor {
  return {
    id: 'actor',
    githubId: ADMIN_GITHUB_ID,
    githubLogin: 'synthetic-admin',
    name: '합성 관리자',
    role: 'ADMIN',
    hasStaffAccess: true,
    hasAdminAccess: true,
    accountStatus: AccountStatus.ACTIVE,
    ...overrides,
  };
}

function profile(
  overrides: Partial<NonNullable<MemberKindTargetRecord['profile']>> = {},
): NonNullable<MemberKindTargetRecord['profile']> {
  return {
    name: '합성 사용자',
    studentId: '123456',
    department: '합성 학과',
    staffNumber: null,
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '합성 학과',
    ...overrides,
  };
}

function studentTarget(
  overrides: Partial<MemberKindTargetRecord> = {},
): MemberKindTargetRecord {
  return {
    id: 'target',
    githubId: 9_700_600_002n,
    githubLogin: 'synthetic-target',
    name: '합성 사용자',
    role: 'STUDENT',
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
    profile: profile(),
    pendingRequest: null,
    ...overrides,
  };
}

function missingProfileTarget(): MemberKindTargetRecord {
  return studentTarget({
    role: null,
    selectedMemberKind: null,
    memberKind: null,
    profile: null,
  });
}

function pendingTarget(): MemberKindTargetRecord {
  return studentTarget({
    pendingRequest: {
      id: 'pending',
      status: 'PENDING',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });
}
