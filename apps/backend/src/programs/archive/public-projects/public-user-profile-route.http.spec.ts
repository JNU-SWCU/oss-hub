import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../../../auth/auth.config';
import { AuthService } from '../../../auth/auth.service';
import { sessionCookieName } from '../../../auth/cookies';
import { OriginGuard } from '../../../auth/origin.guard';
import { issueSessionToken } from '../../../auth/session-token';
import { SessionGuard } from '../../../auth/session.guard';
import { ProblemDetailFilter } from '../../../common/problem-detail.filter';
import { UsersController } from '../../../users/users.controller';
import { UsersService } from '../../../users/users.service';
import { PublicProjectsService } from './public-projects.service';
import { PublicUserProfileController } from './public-user-profile.controller';

const githubId = 4242n;
const sessionSecret = new Uint8Array(32).fill(9);
const allowedOrigin = 'http://frontend.test';
const myProfile = {
  name: '합성 사용자',
  studentId: '123456',
  department: '인공지능학부',
  isComplete: true,
};
const publicProfile = {
  identity: {
    userId: 'synthetic-user-1',
    githubNickname: 'synthetic-login',
    avatarUrl: null,
    githubId: 501n,
  },
  projects: [],
  observedTotals: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
};

const usersService = {
  getMyProfile: jest.fn().mockResolvedValue(myProfile),
  completeMyProfile: jest.fn().mockResolvedValue(myProfile),
  patchMyProfile: jest.fn().mockResolvedValue(myProfile),
};
const publicProjectsService = {
  findProfile: jest.fn().mockResolvedValue(publicProfile),
};

const controllerOrders = [
  {
    name: 'UsersModule 먼저 등록',
    controllers: [UsersController, PublicUserProfileController],
  },
  {
    name: 'PublicProjectsModule 먼저 등록(순서 뒤집기)',
    controllers: [PublicUserProfileController, UsersController],
  },
] as const;

describe.each(controllerOrders)(
  '공개 프로필 라우트 — $name',
  ({ controllers }) => {
    let application: INestApplication;
    let baseUrl = '';
    let sessionCookie = '';

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [...controllers],
        providers: [
          SessionGuard,
          OriginGuard,
          { provide: UsersService, useValue: usersService },
          { provide: PublicProjectsService, useValue: publicProjectsService },
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

    it('비로그인 GET /users/me/profile은 공개 컨트롤러로 새지 않고 401로 막힌다', async () => {
      const response = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
        headers: { connection: 'close' },
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUT_003',
      });
      expect(publicProjectsService.findProfile).not.toHaveBeenCalled();
    });

    it('인증된 GET /users/me/profile은 항상 내 프로필 컨트롤러가 처리한다', async () => {
      const response = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
        headers: { connection: 'close', cookie: sessionCookie },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      await expect(response.json()).resolves.toEqual(myProfile);
      expect(usersService.getMyProfile).toHaveBeenCalledWith(githubId);

      expect(publicProjectsService.findProfile).not.toHaveBeenCalled();
    });

    it('익명 GET /users/:userId/public-profile은 공개 컨트롤러가 처리한다', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/users/synthetic-user-1/public-profile`,
        { headers: { connection: 'close' } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(publicProjectsService.findProfile).toHaveBeenCalledWith(
        'synthetic-user-1',
      );

      const serialized = JSON.stringify(await response.json());
      expect(serialized).not.toContain('501');
      for (const forbidden of ['name', 'studentId', 'department', 'email']) {
        expect(serialized).not.toContain(`"${forbidden}"`);
      }
    });

    it('공개 경로의 `me`는 특별 취급 없이 평범한 userId로만 조회된다', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/users/me/public-profile`,
        { headers: { connection: 'close', cookie: sessionCookie } },
      );

      expect(response.status).toBe(200);
      expect(publicProjectsService.findProfile).toHaveBeenCalledWith('me');

      expect(usersService.getMyProfile).not.toHaveBeenCalled();
    });
  },
);
