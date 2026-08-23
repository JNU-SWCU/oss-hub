import { randomBytes } from 'node:crypto';
import { AccountStatus } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { serializeCookie, sessionCookieName } from './cookies';
import { AuthUser } from './domain/auth-user';
import { HTTP_AUTH_KINDS, type OptionalSessionRequest } from './http-auth';
import { SESSION_MAX_AGE_SECONDS, issueSessionToken } from './session-token';
import { LoginHistoryService } from '../login-history/login-history.service';

const syntheticUser: AuthUser = {
  id: 'synthetic-id',
  githubId: 424242n,
  nickname: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: false,
};
const sessionSecret = new Uint8Array(randomBytes(32));
const clearSessionCookie = serializeCookie(sessionCookieName(true), '', {
  maxAgeSeconds: 0,
  secure: true,
});

function createResponse(): Response & { setHeader: jest.Mock } {
  return { setHeader: jest.fn() } as unknown as Response & {
    setHeader: jest.Mock;
  };
}

function requestWithCookie(cookie?: string): OptionalSessionRequest {
  const request = { headers: { cookie } } as Request;
  return Object.assign(request, {
    auth: {
      kind: HTTP_AUTH_KINDS.ANONYMOUS,
      hasSessionCookie: cookie !== undefined,
    },
  });
}

function authenticatedRequest(
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null = syntheticUser.role,
): OptionalSessionRequest {
  const request = { headers: {} } as Request;
  return Object.assign(request, {
    auth: {
      kind: HTTP_AUTH_KINDS.AUTHENTICATED,
      hasSessionCookie: true as const,
      principal: {
        ...syntheticUser,
        role,
        accountStatus: AccountStatus.ACTIVE,
      },
    },
  });
}

function createController(findMe: jest.Mock): AuthController {
  return new AuthController(
    { findMe } as unknown as AuthService,
    {
      sessionSecret,
      useSecureCookies: true,
    } as unknown as AuthConfig,
    {} as LoginHistoryService,
  );
}

function expectInvalidSession(token: string): void {
  const findMe = jest.fn();
  const res = createResponse();

  const result = createController(findMe).getSession(
    requestWithCookie(`${sessionCookieName(true)}=${token}`),
    res,
  );

  expect(result).toEqual({ isAuthenticated: false });
  expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', clearSessionCookie);
  expect(findMe).not.toHaveBeenCalled();
}

describe('AuthController getSession', () => {
  it('쿠키가 없으면 익명 상태와 private no-store를 반환한다', () => {
    const findMe = jest.fn();
    const res = createResponse();

    const result = createController(findMe).getSession(
      requestWithCookie(),
      res,
    );

    expect(result).toEqual({ isAuthenticated: false });
    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.any(String),
    );
    expect(findMe).not.toHaveBeenCalled();
  });

  it('형식이 잘못된 쿠키는 익명 상태로 수렴하고 삭제한다', () => {
    expectInvalidSession('invalid-token');
  });

  it('서명이 일치하지 않는 쿠키는 익명 상태로 수렴하고 삭제한다', async () => {
    const token = await issueSessionToken(
      new Uint8Array(randomBytes(32)),
      syntheticUser.githubId,
    );

    expectInvalidSession(token);
  });

  it('만료된 쿠키는 익명 상태로 수렴하고 삭제한다', async () => {
    const issuedAt =
      Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60;
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
      issuedAt,
    );

    expectInvalidSession(token);
  });

  it('유효한 세션은 사용자 정보를 포함한 인증 상태를 반환한다', () => {
    const findMe = jest.fn().mockResolvedValue(syntheticUser);

    const result = createController(findMe).getSession(
      authenticatedRequest(),
      createResponse(),
    );

    expect(result).toEqual({
      isAuthenticated: true,
      user: {
        nickname: syntheticUser.nickname,
        name: null,
        avatarUrl: null,
        accountStatus: AccountStatus.ACTIVE,
        role: null,
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: false,
        // 화면 게이트가 "역할은 있는데 프로필이 비어 있는" 사용자를 프로필 단계로
        // 되돌리려면 세션이 이 사실을 함께 실어야 한다.
        isProfileComplete: false,
      },
    });
    expect(findMe).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'STAFF', 'STUDENT', null])(
    'authenticated session role is the DB role: %s',
    (dbRole) => {
      const result = createController(jest.fn()).getSession(
        authenticatedRequest(dbRole),
        createResponse(),
      );

      expect(result).toMatchObject({
        isAuthenticated: true,
        user: {
          nickname: syntheticUser.nickname,
          role: dbRole,
          accountStatus: AccountStatus.ACTIVE,
        },
      });
      expect(result).not.toHaveProperty('login');
    },
  );

  it('유효한 토큰의 사용자가 없으면 익명 상태로 수렴하고 쿠키를 삭제한다', async () => {
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
    );
    const res = createResponse();

    const result = createController(
      jest.fn().mockResolvedValue(null),
    ).getSession(requestWithCookie(`${sessionCookieName(true)}=${token}`), res);

    expect(result).toEqual({ isAuthenticated: false });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      clearSessionCookie,
    );
  });

  it('유효한 토큰의 사용자가 비활성화되면 익명 처리하고 기존 쿠키를 삭제한다', async () => {
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
    );
    const res = createResponse();

    const result = createController(
      jest.fn().mockResolvedValue({
        ...syntheticUser,
        role: 'STAFF',
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    ).getSession(requestWithCookie(`${sessionCookieName(true)}=${token}`), res);

    expect(result).toEqual({ isAuthenticated: false });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      clearSessionCookie,
    );
  });

  it('경계가 붙인 principal을 다시 조회하지 않고 응답한다', () => {
    const findMe = jest.fn().mockRejectedValue(new Error('must not query'));

    const result = createController(findMe).getSession(
      authenticatedRequest(),
      createResponse(),
    );

    expect(result).toMatchObject({ isAuthenticated: true });
    expect(findMe).not.toHaveBeenCalled();
  });
});
