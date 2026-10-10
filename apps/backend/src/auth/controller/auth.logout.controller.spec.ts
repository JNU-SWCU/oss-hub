import { AccountStatus } from '@prisma/client';
import type { Response } from 'express';
import { LoginHistoryService } from '../../login-history/service/login-history.service';
import { AuthConfig } from '../auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from '../service/auth.service';
import type { AuthUser } from '../domain/auth-user';
import { HTTP_AUTH_KINDS, type OptionalSessionRequest } from './http-auth';

const syntheticUser: AuthUser = {
  id: 'synthetic-id',
  githubId: 424242n,
  nickname: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  sessionVersion: 0,
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: false,
};
const sessionSecret = new Uint8Array(32).fill(1);

function response(): Response & { readonly setHeader: jest.Mock } {
  return { setHeader: jest.fn() } as unknown as Response & {
    readonly setHeader: jest.Mock;
  };
}

function request(authenticated: boolean): OptionalSessionRequest {
  if (!authenticated) {
    return {
      headers: {},
      auth: {
        kind: HTTP_AUTH_KINDS.ANONYMOUS,
        hasSessionCookie: false,
      },
    } as OptionalSessionRequest;
  }
  return {
    headers: {},
    auth: {
      kind: HTTP_AUTH_KINDS.AUTHENTICATED,
      hasSessionCookie: true,
      principal: {
        ...syntheticUser,
        accountStatus: AccountStatus.ACTIVE,
      },
    },
  } as OptionalSessionRequest;
}

describe('AuthController logout', () => {
  const findMe = jest.fn();
  const incrementSessionVersion = jest.fn();
  const recordLogout = jest.fn();
  const controller = new AuthController(
    { findMe, incrementSessionVersion } as unknown as AuthService,
    {
      sessionSecret,
      useSecureCookies: true,
    } as unknown as AuthConfig,
    { recordLogout } as unknown as LoginHistoryService,
  );

  beforeEach(() => {
    findMe.mockReset();
    incrementSessionVersion.mockReset();
    incrementSessionVersion.mockResolvedValue(undefined);
    recordLogout.mockReset();
    recordLogout.mockResolvedValue(undefined);
  });

  it('유효한 세션의 로그아웃을 해당 사용자 이력으로 기록한다', async () => {
    findMe.mockResolvedValue(syntheticUser);

    const result = await controller.logout(request(true), response());

    expect(result).toEqual({ isAuthenticated: false });
    expect(incrementSessionVersion).toHaveBeenCalledWith(
      syntheticUser.githubId,
    );
    expect(findMe).toHaveBeenCalledWith(syntheticUser.githubId);
    expect(recordLogout).toHaveBeenCalledWith(syntheticUser.id);
  });

  it('세션이 없는 기존 로그아웃 요청은 이력 없이 200 동작을 유지한다', async () => {
    const result = await controller.logout(request(false), response());

    expect(result).toEqual({ isAuthenticated: false });
    expect(incrementSessionVersion).not.toHaveBeenCalled();
    expect(findMe).not.toHaveBeenCalled();
    expect(recordLogout).not.toHaveBeenCalled();
  });

  it.each([
    ['사용자 조회', findMe],
    ['로그아웃 이력 저장', recordLogout],
  ])('%s 실패에도 쿠키 삭제와 200 응답을 유지한다', async (_label, failure) => {
    const res = response();
    findMe.mockResolvedValue(syntheticUser);
    failure.mockRejectedValue(new Error('synthetic history failure'));

    const result = await controller.logout(request(true), res);

    expect(result).toEqual({ isAuthenticated: false });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    );
  });
});
