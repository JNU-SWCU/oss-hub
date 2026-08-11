import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileService } from './admin-profile.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Issue #787 — 온보딩 프로필 저장이 관리자 대리 수정 라우트에 가로채여 403(ROL_004)이
 * 났던 회귀를 고정한다.
 *
 * `UsersController`(`PATCH /users/me/profile`, SessionGuard 보호)와
 * `AdminAccessController`(`PATCH /users/:id/profile`, admin 전용)는 같은 `users`
 * 리소스 프리픽스 아래에서 **경로 모양 자체가 겹친다**(`me`가 `:id`에 그대로 매치).
 * #551의 공개 프로필 라우트와 달리 마지막 세그먼트가 같으므로, 등록 순서를 뒤집으면
 * 실제로 `me`가 `:id`로 흡수된다 — 그래서 이 스펙은 두 가지를 각각 고정한다.
 *
 * 1. `UsersModule`의 실제 등록 순서(`UsersController`가 먼저)에서 일반 사용자의
 *    온보딩 저장이 admin 라우트로 새지 않고 200을 받는다.
 * 2. 등록 순서와 무관하게, `AdminAccessController`에 `me`가 도달하면
 *    `requireValidUserId`가 400/ROL_011로 거부한다(이중 방어) — 다른 경로
 *    (`/users/:id/access`)로 직접 검증해 순서 의존성을 없앤다.
 */
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
      // UsersModule과 동일한 순서 — UsersController가 AdminAccessController보다
      // 먼저 등록돼야 `/users/me/profile`이 `:id`로 흡수되지 않는다.
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
            getMe: jest.fn().mockResolvedValue({ id: 'synthetic-user' }),
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
    )}`;
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await application.close();
  });

  it('일반 사용자의 PATCH /users/me/profile은 온보딩 컨트롤러가 처리한다(200)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
      method: 'PATCH',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        cookie: sessionCookie,
        origin: allowedOrigin,
      },
      body: JSON.stringify({ name: '합성 새 이름' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(myProfile);
    expect(usersService.patchMyProfile).toHaveBeenCalledWith(githubId, {
      name: '합성 새 이름',
    });
    // 'me'가 관리자 대리 수정의 `:id`로 흡수되지 않았다는 직접 증거 —
    // 흡수됐다면 admin 전용 게이트(ROL_004)에 막혀 403이 났을 것이다.
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
    // `/users/:id/access`는 UsersController와 겹치지 않는 경로라 등록 순서와
    // 무관하게 AdminAccessController가 받는다 — requireValidUserId가 'me'를
    // 여전히 거부하는지를 순서 의존성 없이 직접 확인한다.
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
