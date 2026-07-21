import { randomBytes } from 'node:crypto';
import { AccountStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { LoginHistoryService } from '../login-history/login-history.service';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import type { AuthUser } from './domain/auth-user';
import { issueSessionToken } from './session-token';

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

function response(): Response & { readonly setHeader: jest.Mock } {
  return { setHeader: jest.fn() } as unknown as Response & {
    readonly setHeader: jest.Mock;
  };
}

function request(cookie?: string): Request {
  return { headers: { cookie } } as Request;
}

describe('AuthController logout', () => {
  const findMe = jest.fn();
  const recordLogout = jest.fn();
  const controller = new AuthController(
    { findMe } as unknown as AuthService,
    {
      sessionSecret,
      useSecureCookies: true,
    } as unknown as AuthConfig,
    { recordLogout } as unknown as LoginHistoryService,
  );

  beforeEach(() => {
    findMe.mockReset();
    recordLogout.mockReset();
    recordLogout.mockResolvedValue(undefined);
  });

  it('유효한 세션의 로그아웃을 해당 사용자 이력으로 기록한다', async () => {
    // Given: 기존 사용자에게 발급한 유효한 세션이 있다.
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
    );
    findMe.mockResolvedValue(syntheticUser);

    // When: 사용자가 로그아웃한다.
    const result = await controller.logout(
      request(`${sessionCookieName(true)}=${token}`),
      response(),
    );

    // Then: 본인 사용자 ID로 로그아웃 이력이 추가된다.
    expect(result).toEqual({ isAuthenticated: false });
    expect(findMe).toHaveBeenCalledWith(syntheticUser.githubId);
    expect(recordLogout).toHaveBeenCalledWith(syntheticUser.id);
  });

  it('세션이 없는 기존 로그아웃 요청은 이력 없이 200 동작을 유지한다', async () => {
    // Given: 세션 쿠키가 없다.

    // When: 익명 사용자가 로그아웃한다.
    const result = await controller.logout(request(), response());

    // Then: 사용자 이력을 만들지 않고 기존 응답을 반환한다.
    expect(result).toEqual({ isAuthenticated: false });
    expect(findMe).not.toHaveBeenCalled();
    expect(recordLogout).not.toHaveBeenCalled();
  });

  it.each([
    ['사용자 조회', findMe],
    ['로그아웃 이력 저장', recordLogout],
  ])('%s 실패에도 쿠키 삭제와 200 응답을 유지한다', async (_label, failure) => {
    const token = await issueSessionToken(
      sessionSecret,
      syntheticUser.githubId,
    );
    const res = response();
    findMe.mockResolvedValue(syntheticUser);
    failure.mockRejectedValue(new Error('synthetic history failure'));

    const result = await controller.logout(
      request(`${sessionCookieName(true)}=${token}`),
      res,
    );

    expect(result).toEqual({ isAuthenticated: false });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    );
  });
});
