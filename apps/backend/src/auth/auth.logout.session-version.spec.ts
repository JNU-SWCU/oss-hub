import { randomBytes } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AccountStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { SignJWT } from 'jose';
import type { LoginHistoryService } from '../login-history/login-history.service';
import { AuthenticationGuard } from './authentication.guard';
import { OPTIONAL_SESSION_ROUTE_METADATA } from './auth-route-metadata';
import type { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import type { AuthUser } from './domain/auth-user';
import type { OptionalSessionRequest } from './http-auth';

const sessionSecret = new Uint8Array(randomBytes(32));
const tokenIssuedAt = 4_000_000_000;
const syntheticUser: AuthUser = {
  id: 'synthetic-revocation-user',
  githubId: 424_242n,
  nickname: 'synthetic-revocation-user',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  sessionVersion: 0,
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: false,
};

function config(): AuthConfig {
  return {
    sessionSecret,
    useSecureCookies: true,
  } as unknown as AuthConfig;
}

function response(): Response & { readonly setHeader: jest.Mock } {
  return { setHeader: jest.fn() } as unknown as Response & {
    readonly setHeader: jest.Mock;
  };
}

function request(cookie: string): Request {
  return { headers: { cookie } } as Request;
}

async function copiedSessionCookie(
  sessionVersion: number = 0,
): Promise<string> {
  const token = await new SignJWT({ sessionVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(syntheticUser.githubId.toString(10))
    .setIssuer('oss-hub')
    .setAudience('oss-hub-web')
    .setIssuedAt(tokenIssuedAt)
    .setExpirationTime(tokenIssuedAt + 60)
    .sign(sessionSecret);
  return `${sessionCookieName(true)}=${token}`;
}

function statefulAuthService(revocationFailure?: Error): {
  readonly authService: AuthService;
  readonly incrementSessionVersion: jest.Mock;
} {
  let liveSessionVersion = 0;
  const incrementSessionVersion = jest.fn().mockImplementation(() => {
    if (revocationFailure !== undefined) {
      return Promise.reject(revocationFailure);
    }
    liveSessionVersion += 1;
    return Promise.resolve(liveSessionVersion);
  });
  return {
    authService: {
      findMe: jest.fn().mockResolvedValue(syntheticUser),
      findActivePrincipal: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...syntheticUser,
          sessionVersion: liveSessionVersion,
        }),
      ),
      incrementSessionVersion,
    } as unknown as AuthService,
    incrementSessionVersion,
  };
}

function controllerWith(authService: AuthService): AuthController {
  return new AuthController(authService, config(), {
    recordLogout: jest.fn(),
  } as unknown as LoginHistoryService);
}

function optionalSessionContext(cookie: string): {
  readonly context: ExecutionContext;
  readonly request: Request;
} {
  const replayRequest = request(cookie);
  return {
    context: {
      getHandler: () => () => undefined,
      getClass: () => AuthController,
      switchToHttp: () => ({
        getRequest: () => replayRequest,
        getResponse: () => response(),
      }),
    } as unknown as ExecutionContext,
    request: replayRequest,
  };
}

function optionalSessionReflector(): Reflector {
  return {
    getAllAndOverride: jest
      .fn()
      .mockImplementation(
        (metadataKey: unknown) =>
          metadataKey === OPTIONAL_SESSION_ROUTE_METADATA,
      ),
  } as unknown as Reflector;
}

async function authenticateRequest(
  authService: AuthService,
  cookie: string,
): Promise<OptionalSessionRequest> {
  const { context, request: sessionRequest } = optionalSessionContext(cookie);
  const guard = new AuthenticationGuard(
    optionalSessionReflector(),
    config(),
    authService,
  );
  await guard.canActivate(context);
  return sessionRequest as OptionalSessionRequest;
}

describe('AuthController logout session revocation', () => {
  it('stale logout replay는 새 세대를 다시 무효화하지 않는다', async () => {
    const copiedCookie = await copiedSessionCookie();
    const { authService, incrementSessionVersion } = statefulAuthService();
    const controller = controllerWith(authService);

    const currentLogoutRequest = await authenticateRequest(
      authService,
      copiedCookie,
    );
    await controller.logout(currentLogoutRequest, response());
    const staleLogoutRequest = await authenticateRequest(
      authService,
      copiedCookie,
    );
    await controller.logout(staleLogoutRequest, response());
    const currentCookie = await copiedSessionCookie(1);
    const currentRequest = await authenticateRequest(
      authService,
      currentCookie,
    );
    const currentSession = controller.getSession(currentRequest, response());

    expect(staleLogoutRequest.auth).toMatchObject({ kind: 'ANONYMOUS' });
    expect(incrementSessionVersion).toHaveBeenCalledTimes(1);
    expect(currentSession).toMatchObject({ isAuthenticated: true });
  });

  it('세션 세대 저장 실패는 쿠키를 지워도 성공 응답으로 숨기지 않는다', async () => {
    const cookie = await copiedSessionCookie();
    const persistenceFailure = new Error(
      'synthetic session revocation persistence failure',
    );
    const { authService } = statefulAuthService(persistenceFailure);
    const controller = controllerWith(authService);
    const res = response();
    const logoutRequest = await authenticateRequest(authService, cookie);

    await expect(controller.logout(logoutRequest, res)).rejects.toBe(
      persistenceFailure,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    );
  });
});
