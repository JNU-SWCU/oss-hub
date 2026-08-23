import { randomBytes } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, MemberKind } from '@prisma/client';
import { AuthenticationGuard } from './authentication.guard';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import type { AuthUser } from './domain/auth-user';
import { OriginGuard } from './origin.guard';
import { issueSessionToken, SESSION_MAX_AGE_SECONDS } from './session-token';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { SystemErrorCode } from '../common/system-error-code.enum';
import { LoginHistoryService } from '../login-history/login-history.service';

const sessionSecret = new Uint8Array(randomBytes(32));
const githubId = 424242n;
const activeUser: AuthUser = {
  name: null,
  id: 'synthetic-session-contract-user',
  githubId,
  nickname: 'synthetic-user',
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  memberKind: MemberKind.STAFF,
  hasStaffAccess: true,
  hasAdminAccess: false,
  isProfileComplete: true,
};

describe('canonical auth session HTTP contract', () => {
  let application: INestApplication;
  let baseUrl: string;
  let sessionCookie: string;
  let expiredSessionCookie: string;

  beforeAll(async () => {
    const authService = {
      findActivePrincipal: jest.fn().mockResolvedValue(activeUser),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthenticationGuard,
        OriginGuard,
        { provide: AuthService, useValue: authService },
        {
          provide: AuthConfig,
          useValue: {
            allowedOrigin: 'http://frontend.test',
            frontendUrl: 'http://frontend.test',
            sessionSecret,
            useSecureCookies: false,
          },
        },
        {
          provide: LoginHistoryService,
          useValue: { recordLogin: jest.fn(), recordLogout: jest.fn() },
        },
      ],
    }).compile();

    application = moduleRef.createNestApplication();
    application.useGlobalGuards(moduleRef.get(AuthenticationGuard));
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
    expiredSessionCookie = `${sessionCookieName(
      false,
    )}=${await issueSessionToken(
      sessionSecret,
      githubId,
      Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60,
    )}`;
  });

  afterAll(async () => {
    await application.close();
  });

  function request(path: string, cookie?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      headers:
        cookie === undefined
          ? { connection: 'close' }
          : { connection: 'close', cookie },
      redirect: 'manual',
    });
  }

  it.each([
    ['anonymous', undefined],
    ['authenticated', () => sessionCookie],
    ['expired', () => expiredSessionCookie],
  ] as const)(
    'GET /api/v1/auth/me is absent (%s → 404 SYS_002)',
    async (_label, cookie) => {
      const header = typeof cookie === 'function' ? cookie() : cookie;
      const response = await request('/api/v1/auth/me', header);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        status: 404,
        code: SystemErrorCode.ROUTE_NOT_FOUND,
      });
    },
  );

  it('GET /api/v1/auth/session returns the anonymous discriminant without a cookie', async () => {
    const response = await request('/api/v1/auth/session');

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({ isAuthenticated: false });
    expect(body).not.toHaveProperty('user');
  });

  it('GET /api/v1/auth/session returns the authenticated discriminant with canonical access facts', async () => {
    const response = await request('/api/v1/auth/session', sessionCookie);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isAuthenticated: true,
      user: {
        nickname: activeUser.nickname,
        name: null,
        avatarUrl: null,
        accountStatus: AccountStatus.ACTIVE,
        memberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        hasAdminAccess: false,
        isProfileComplete: true,
      },
    });
  });

  it('GET /api/v1/auth/session keeps generic anonymous representation for an invalid cookie', async () => {
    const response = await request(
      '/api/v1/auth/session',
      expiredSessionCookie,
    );

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({ isAuthenticated: false });
    expect(body).not.toHaveProperty('user');
  });
});
