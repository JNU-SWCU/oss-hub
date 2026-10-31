import { AdminProfileMutationService } from './admin-profile-mutation.service';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../platform/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../platform/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { AccessRequestsController } from '../staff/access-requests.controller';
import { UserAccessController } from '../admin/user-access.controller';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileService } from './admin-profile.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { GLOBAL_AUTHENTICATION_GUARD_PROVIDERS } from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

const githubId = 4242n;
const sessionSecret = new Uint8Array(32).fill(9);
const allowedOrigin = 'http://frontend.test';
const myProfile = {
  name: '합성 사용자',
  studentId: '123456',
  department: '인공지능학부',
  isComplete: true,
};

const usersService = {
  getMyProfile: jest.fn().mockResolvedValue(myProfile),
  completeMyProfile: jest.fn().mockResolvedValue(myProfile),
  patchMyProfile: jest.fn().mockResolvedValue(myProfile),
};
const adminAccessMutationService = new AdminAccessMutationService(
  new AuditLogMetadataService(),
  new UserProfileService(),
);
const adminAccessService = Object.assign(
  Object.create(AdminAccessService.prototype) as object,
  {
    adminAccessMutationService,
    list: jest.fn(),
    facets: jest.fn(),
    get: jest.fn(),
    getHistory: jest.fn(),
    patchAccess: jest.fn(),
  },
);
const adminProfileService = Object.assign(
  Object.create(AdminProfileService.prototype) as object,
  {
    adminAccessMutationService,
    adminProfileMutationService: new AdminProfileMutationService(
      new AuditLogMetadataService(),
      new UserProfileService(),
      adminAccessMutationService,
    ),
    patchProfile: jest.fn().mockResolvedValue({
      id: 'admin-target',
      name: null,
      studentId: null,
      department: null,
    }),
  },
);

describe('온보딩 프로필 저장 라우트 — UsersModule 실제 등록 순서', () => {
  let application: INestApplication;
  let baseUrl = '';
  let sessionCookie = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        UsersController,
        UserAccessController,
        AccessRequestsController,
      ],
      providers: [
        ...STATELESS_PROVIDERS,
        AdminAccessMutationService,
        AuditLogMetadataService,
        UserProfileService,
        ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
        OriginGuard,
        {
          provide: UsersService,
          useValue: Object.assign(
            Object.create(UsersService.prototype) as UsersService,
            usersService,
          ),
        },
        { provide: AdminAccessService, useValue: adminAccessService },
        { provide: AdminProfileService, useValue: adminProfileService },
        {
          provide: AuthService,
          useValue: {
            getMe: jest
              .fn()
              .mockResolvedValue({ id: 'synthetic-user', sessionVersion: 0 }),
          },
        },
        {
          provide: AuthConfig,
          useValue: {
            sessionSecret,
            allowedOrigin,
            useSecureCookies: false,
          },
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
    sessionCookie = `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(
      sessionSecret,
      githubId,
      0,
    )}`;
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await application.close();
  });

  it('일반 사용자의 POST /users/me/profile은 온보딩 컨트롤러가 처리한다(201)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
      method: 'POST',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        cookie: sessionCookie,
        origin: allowedOrigin,
      },
      body: JSON.stringify({
        name: '합성 새 이름',
        department: '인공지능학부',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(myProfile);
    expect(usersService.completeMyProfile).toHaveBeenCalledWith(githubId, {
      name: '합성 새 이름',
      department: '인공지능학부',
    });
    expect(adminProfileService.patchProfile).not.toHaveBeenCalled();
  });

  it('관리자 대리 수정 PATCH /users/:id/profile은 실제 대상 id에는 그대로 도달한다', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/users/admin-target/profile`,
      {
        method: 'PATCH',
        headers: {
          connection: 'close',
          'content-type': 'application/json',
          cookie: sessionCookie,
          origin: allowedOrigin,
        },
        body: JSON.stringify({ name: '합성 관리자 수정' }),
      },
    );

    expect(response.status).toBe(200);
    expect(adminProfileService.patchProfile).toHaveBeenCalledWith(
      githubId,
      'admin-target',
      { name: '합성 관리자 수정' },
    );
    expect(usersService.patchMyProfile).not.toHaveBeenCalled();
  });

  it("'me'를 관리자 라우트로 보내면 400/ROL_011로 거부된다(이중 방어, 순서와 무관)", async () => {
    const response = await fetch(`${baseUrl}/api/v1/users/me/access`, {
      headers: { connection: 'close', cookie: sessionCookie },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ROL_011',
    });
    expect(adminAccessService.get).not.toHaveBeenCalled();
  });
});
