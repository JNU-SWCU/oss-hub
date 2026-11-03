import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlatformModule } from '../platform/platform.module';
import { AuthConfig } from '../platform/auth.config';
import { AuthService } from '../auth/auth.service';
import { AuthModule } from '../auth/auth.module';
import { buildRow } from '../auth/auth.repository.spec-support';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { UserHistoryRepository } from './user-history.repository';
import { MemberRegistrationResetRepository } from './member-registration-reset.repository';
import { UserAccessController } from '../admin/user-access.controller';
import { UsersModule } from './users.module';
const authSessionService = new AuthSessionService();
const ADMIN_GITHUB_ID = 9700600001n;
const sessionSecret = new Uint8Array(32).fill(41);
const allowedOrigin = 'http://frontend.test';
describe('POST /users/:id/member-kind/reset HTTP contract', () => {
  let target = buildRow({ id: 'target', type: 'STUDENT' });
  const store = {
    auditLogWriter: new PrismaService(),
    lockActiveAdmins: async () => {},
    findActorByGithubId: () =>
      Promise.resolve({
        id: 'actor',
        githubId: ADMIN_GITHUB_ID,
        githubLogin: 'synthetic-admin',
        name: null,
        memberKind: null,
        department: null,
        profileCreatedAt: null,
        approvalStatus: 'NOT_REQUIRED',
        hasAdminAccess: true,
        accountStatus: 'ACTIVE',
      }),
    findTargetForUpdate: () => Promise.resolve(target),
    hasActivity: () => Promise.resolve(false),
    resetRegistration: jest.fn().mockResolvedValue(true),
  };
  const repository = {
    withTransaction: (operation: (value: typeof store) => Promise<unknown>) =>
      operation(store),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  let application: INestApplication;
  let baseUrl = '';
  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      imports: [PlatformModule, AuthModule, UsersModule],
      controllers: [UserAccessController],
    }).useMocker((token) => (token === Function ? undefined : {}));
    moduleBuilder.overrideProvider(PrismaService).useValue({});
    moduleBuilder
      .overrideProvider(MemberRegistrationResetRepository)
      .useValue(repository);
    moduleBuilder.overrideProvider(UserHistoryRepository).useValue(audit);
    moduleBuilder.overrideProvider(AuthConfig).useValue({
      sessionSecret,
      allowedOrigin,
      useSecureCookies: false,
    });
    moduleBuilder.overrideProvider(AuthService).useValue({
      getMe: jest.fn().mockResolvedValue({ id: 'actor', sessionVersion: 0 }),
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
    target = buildRow({ id: 'target', type: 'STUDENT' });
    audit.record.mockClear();
  });
  afterAll(async () => {
    await application.close();
  });

  const body = {
    expectedMemberKind: 'STUDENT',
    expectedApprovalStatus: 'NOT_REQUIRED',
    expectedApprovalRequestId: null,
  };
  async function request(
    payload: object = body,
    cookie = true,
    origin = allowedOrigin,
    method = 'POST',
    path = 'member-kind/reset',
  ) {
    return fetch(baseUrl + '/api/v1/users/target/' + path, {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        ...(cookie
          ? {
              cookie:
                authSessionService.sessionCookieName(false) +
                '=' +
                (await authSessionService.issueSessionToken(
                  sessionSecret,
                  ADMIN_GITHUB_ID,
                  0,
                )),
            }
          : {}),
      },
      body: JSON.stringify(payload),
    });
  }
  it('returns the existing mutation response with a null member kind', async () => {
    const response = await request();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: 'target',
      memberKind: null,
      role: null,
      hasStaffAccess: false,
      approvalStatus: 'NOT_REQUIRED',
      approvalRequestId: null,
    });
  });
  it.each([
    { expectedMemberKind: 'NOPE' },
    { expectedApprovalStatus: null },
    { expectedApprovalRequestId: undefined },
    { memberKind: 'STAFF' },
  ])('rejects invalid or legacy fields %j', async (patch) => {
    expect((await request({ ...body, ...patch })).status).toBe(400);
  });
  it('requires an authenticated session', async () => {
    expect((await request(body, false)).status).toBe(401);
  });
  it('requires the allowed origin', async () => {
    expect((await request(body, true, 'http://other.test')).status).toBe(403);
  });
  it('removes the old PATCH route', async () => {
    expect(
      (await request(body, true, allowedOrigin, 'PATCH', 'member-kind')).status,
    ).toBe(404);
  });
  it('returns stale state as a public 409 problem', async () => {
    target = buildRow({
      id: 'target',
      type: 'STAFF',
      approvalStatus: 'PENDING',
    });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'ROL_013' });
  });
});
