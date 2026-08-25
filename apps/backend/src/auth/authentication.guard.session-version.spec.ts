import { randomBytes } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AccountStatus } from '@prisma/client';
import type { Request } from 'express';
import { SignJWT } from 'jose';
import { AuthenticationGuard } from './authentication.guard';
import { OPTIONAL_SESSION_ROUTE_METADATA } from './auth-route-metadata';
import type { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import { HTTP_AUTH_KINDS, type OptionalSessionRequest } from './http-auth';

const secret = new Uint8Array(randomBytes(32));
const githubId = 9_007_199_254_740_993n;
const tokenIssuedAt = 4_000_000_000;

function config(): AuthConfig {
  return {
    sessionSecret: secret,
    useSecureCookies: true,
  } as unknown as AuthConfig;
}

async function signedToken(sessionVersion: number): Promise<string> {
  return new SignJWT({ sessionVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(githubId.toString(10))
    .setIssuer('oss-hub')
    .setAudience('oss-hub-web')
    .setIssuedAt(tokenIssuedAt)
    .setExpirationTime(tokenIssuedAt + 60)
    .sign(secret);
}

function optionalSessionContext(cookie: string): {
  readonly context: ExecutionContext;
  readonly request: Request;
} {
  const request = { headers: { cookie } } as Request;
  const context = {
    getHandler: () => () => undefined,
    getClass: () => AuthController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
  return { context, request };
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

function authServiceWithVersion(sessionVersion: number): {
  readonly authService: AuthService;
  readonly findActivePrincipal: jest.Mock;
} {
  const findActivePrincipal = jest.fn().mockResolvedValue({
    id: 'synthetic-session-user',
    githubId,
    nickname: 'synthetic-session-user',
    name: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: false,
    sessionVersion,
  });
  return {
    authService: { findActivePrincipal } as unknown as AuthService,
    findActivePrincipal,
  };
}

async function resolveOptionalSession(
  claimedVersion: number,
  liveVersion: number,
): Promise<{
  readonly request: OptionalSessionRequest;
  readonly findActivePrincipal: jest.Mock;
}> {
  const token = await signedToken(claimedVersion);
  const cookie = `${sessionCookieName(true)}=${token}`;
  const { context, request } = optionalSessionContext(cookie);
  const { authService, findActivePrincipal } =
    authServiceWithVersion(liveVersion);
  const guard = new AuthenticationGuard(
    optionalSessionReflector(),
    config(),
    authService,
  );

  await guard.canActivate(context);

  return {
    request: request as OptionalSessionRequest,
    findActivePrincipal,
  };
}

describe('AuthenticationGuard sessionVersion', () => {
  it('서명된 claim이 live principal 세대와 다르면 익명으로 수렴한다', async () => {
    const { request, findActivePrincipal } = await resolveOptionalSession(4, 5);

    expect(request.auth).toEqual({
      kind: HTTP_AUTH_KINDS.ANONYMOUS,
      hasSessionCookie: true,
    });
    expect(findActivePrincipal).toHaveBeenCalledWith(githubId);
  });

  it('서명된 claim이 live principal 세대와 같으면 principal을 붙인다', async () => {
    const { request } = await resolveOptionalSession(5, 5);

    expect(request.auth).toMatchObject({
      kind: HTTP_AUTH_KINDS.AUTHENTICATED,
      hasSessionCookie: true,
      principal: { githubId },
    });
  });
});
