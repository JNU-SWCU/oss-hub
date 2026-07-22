import { randomBytes } from 'node:crypto';
import { AccountStatus, Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { serializeCookie, sessionCookieName } from './cookies';
import { AuthUser } from './domain/auth-user';
import { SESSION_MAX_AGE_SECONDS, issueSessionToken } from './session-token';
import { LoginHistoryService } from '../login-history/login-history.service';

const syntheticUser: AuthUser = {
  id: 'synthetic-id',
  githubId: 424242n,
  login: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  role: null,
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

function requestWithCookie(cookie?: string): Request {
  return { headers: { cookie } } as Request;
}

function createController(findMe: jest.Mock): AuthController {
  return new AuthController(
    { findMe } as unknown as AuthService,
    {
      sessionSecret,
      useSecureCookies: true,
      resolveTestRole: jest.fn().mockReturnValue(null),
    } as unknown as AuthConfig,
    {} as LoginHistoryService,
  );
}

async function expectInvalidSession(token: string): Promise<void> {
  const findMe = jest.fn();
  const res = createResponse();

  const result = await createController(findMe).getSession(
    requestWithCookie(`${sessionCookieName(true)}=${token}`),
    res,
  );

  expect(result).toEqual({ isAuthenticated: false });
  expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', clearSessionCookie);
  expect(findMe).not.toHaveBeenCalled();
}

describe('AuthController getSession', () => {
  it('쿠키가 없으면 익명 상태와 private no-store를 반환한다', async () => {
    const findMe = jest.fn();
    const res = createResponse();

    const result = await createController(findMe).getSession(
      requestWithCookie(),
      res,
    );

    expect(result).toEqual({ isAuthenticated: false });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.any(String),
    );
    expect(findMe).not.toHaveBeenCalled();
  });

  it('형식이 잘못된 쿠키는 익명 상태로 수렴하고 삭제한다', async () => {
    await expectInvalidSession('invalid-token');
  });

  it('서명이 일치하지 않는 쿠키는 익명 상태로 수렴하고 삭제한다', async () => {
    const token = await issueSessionToken(
      new Uint8Array(randomBytes(32)),
      syntheticUser.githubId,
    );

    await expectInvalidSession(token);
  });

  it('만료된 쿠키는 익명 상태로 수렴하고 삭제한다', async () => {
    const issuedAt =
      Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60;
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
      issuedAt,
    );

    await expectInvalidSession(token);
  });

  it('유효한 세션은 사용자 정보를 포함한 인증 상태를 반환한다', async () => {
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
    );
    const findMe = jest.fn().mockResolvedValue(syntheticUser);

    const result = await createController(findMe).getSession(
      requestWithCookie(`${sessionCookieName(true)}=${token}`),
      createResponse(),
    );

    expect(result).toEqual({
      isAuthenticated: true,
      user: {
        login: syntheticUser.login,
        name: null,
        avatarUrl: null,
        accountStatus: AccountStatus.ACTIVE,
        role: null,
      },
    });
    expect(findMe).toHaveBeenCalledWith(syntheticUser.githubId);
  });

  it('유효한 토큰의 사용자가 없으면 익명 상태로 수렴하고 쿠키를 삭제한다', async () => {
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
    );
    const res = createResponse();

    const result = await createController(
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

    const result = await createController(
      jest.fn().mockResolvedValue({
        ...syntheticUser,
        role: Role.STAFF,
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    ).getSession(requestWithCookie(`${sessionCookieName(true)}=${token}`), res);

    expect(result).toEqual({ isAuthenticated: false });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      clearSessionCookie,
    );
  });

  it('사용자 조회 장애는 익명 상태로 숨기지 않는다', async () => {
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
    );
    const failure = new Error('synthetic database failure');

    await expect(
      createController(jest.fn().mockRejectedValue(failure)).getSession(
        requestWithCookie(`${sessionCookieName(true)}=${token}`),
        createResponse(),
      ),
    ).rejects.toBe(failure);
  });
});
