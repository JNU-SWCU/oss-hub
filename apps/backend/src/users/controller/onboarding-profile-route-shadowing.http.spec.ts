import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../../auth/auth.config';
import { AuthService } from '../../auth/service/auth.service';
import { sessionCookieName } from '../../auth/domain/cookies';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { issueSessionToken } from '../../auth/domain/session-token';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ProblemDetailFilter } from '../../common/controller/problem-detail.filter';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from '../service/admin-access.service';
import { AdminProfileService } from '../service/admin-profile.service';
import { UsersController } from './users.controller';
import { UsersService } from '../service/users.service';

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
const adminAccessService = {
  list: jest.fn(),
  facets: jest.fn(),
  get: jest.fn(),
  getHistory: jest.fn(),
  patchAccess: jest.fn(),
};
const adminProfileService = {
  patchProfile: jest.fn().mockResolvedValue({
    id: 'admin-target',
    name: null,
    studentId: null,
    department: null,
  }),
};

describe('온보딩 프로필 저장 라우트 — UsersModule 실제 등록 순서', () => {
  let application: INestApplication;
  let baseUrl = '';
  let sessionCookie = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController, AdminAccessController],
      providers: [
        SessionGuard,
        OriginGuard,
        { provide: UsersService, useValue: usersService },
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
    sessionCookie = `${sessionCookieName(false)}=${await issueSessionToken(
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
