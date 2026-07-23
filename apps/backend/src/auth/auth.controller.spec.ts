import { AccountStatus, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { flowCookieName, serializeCookie, sessionCookieName } from './cookies';
import { AuthUser } from './domain/auth-user';
import { createFlowState, encodeFlowCookie } from './oauth-flow';
import { AuthenticatedRequest } from './session.guard';
import { LoginHistoryService } from '../login-history/login-history.service';

const syntheticUser: AuthUser = {
  id: 'synthetic-id',
  githubId: 424242n,
  nickname: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  role: null,
};
const recordLogin = jest.fn();

function createResponse(): Response & {
  setHeader: jest.Mock;
  redirect: jest.Mock;
} {
  return {
    setHeader: jest.fn(),
    redirect: jest.fn(),
  } as unknown as Response & { setHeader: jest.Mock; redirect: jest.Mock };
}

function createController(
  serviceOverrides: Partial<AuthService> = {},
): AuthController {
  const service = {
    completeLogin: jest
      .fn()
      .mockResolvedValue({ user: syntheticUser, isNew: false }),
    issueSession: jest.fn().mockResolvedValue('synthetic-session'),
    ...serviceOverrides,
  } as unknown as AuthService;
  const config = {
    frontendUrl: 'https://oss.example',
    useSecureCookies: true,
  } as AuthConfig;
  return new AuthController(service, config, {
    recordLogin,
  } as unknown as LoginHistoryService);
}

function requestWithCookie(cookie?: string): Request {
  return {
    headers: { cookie },
    path: '/api/v1/auth/github/callback',
  } as Request;
}

describe('AuthController github callback', () => {
  beforeEach(() => {
    recordLogin.mockReset();
    recordLogin.mockResolvedValue(undefined);
  });

  it('callback redirect 응답에 no-referrer/no-store를 설정한다', async () => {
    const flow = createFlowState();
    const res = createResponse();

    await createController().githubCallback(
      'synthetic-code',
      flow.state,
      undefined,
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Referrer-Policy',
      'no-referrer',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://oss.example');
    expect(recordLogin).toHaveBeenCalledWith(syntheticUser.id);
  });

  it('신규 사용자는 세션 발급 후 동의 화면으로 바로 이동한다', async () => {
    const flow = createFlowState();
    const res = createResponse();
    const completeLogin = jest
      .fn()
      .mockResolvedValue({ user: syntheticUser, isNew: true });

    await createController({ completeLogin }).githubCallback(
      'synthetic-code',
      flow.state,
      undefined,
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://oss.example/consent',
    );
  });

  it('로그인 이력 저장 실패가 정상 세션 발급을 막지 않는다', async () => {
    const flow = createFlowState();
    const res = createResponse();
    recordLogin.mockRejectedValue(new Error('synthetic history failure'));

    await createController().githubCallback(
      'synthetic-code',
      flow.state,
      undefined,
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://oss.example');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.arrayContaining([
        expect.stringContaining(`${sessionCookieName(true)}=`),
      ]),
    );
  });

  it('OAuth denial은 state가 일치할 때만 flow cookie를 삭제한다', async () => {
    const flow = createFlowState();
    const res = createResponse();

    await createController().githubCallback(
      undefined,
      flow.state,
      'access_denied',
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      serializeCookie(flowCookieName(true), '', {
        maxAgeSeconds: 0,
        secure: true,
      }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://oss.example/?authError=1',
    );
  });

  it.each([
    ['missing state', undefined],
    ['mismatched state', 'x'.repeat(43)],
  ])('%s이면 unrelated flow cookie를 보존한다', async (_label, state) => {
    const flow = createFlowState();
    const res = createResponse();

    await createController().githubCallback(
      undefined,
      state,
      'access_denied',
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.any(String),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://oss.example/?authError=1',
    );
  });

  it('code가 있는 mismatched callback 실패도 unrelated flow cookie를 보존한다', async () => {
    const flow = createFlowState();
    const res = createResponse();
    const completeLogin = jest
      .fn()
      .mockRejectedValue(new Error('invalid flow'));

    await createController({ completeLogin }).githubCallback(
      'synthetic-code',
      'x'.repeat(43),
      undefined,
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.any(String),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://oss.example/?authError=1',
    );
  });

  it('state가 일치한 callback의 provider 실패는 flow cookie를 삭제한다', async () => {
    const flow = createFlowState();
    const res = createResponse();
    const completeLogin = jest
      .fn()
      .mockRejectedValue(new Error('provider failure'));

    await createController({ completeLogin }).githubCallback(
      'synthetic-code',
      flow.state,
      undefined,
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      serializeCookie(flowCookieName(true), '', {
        maxAgeSeconds: 0,
        secure: true,
      }),
    );
  });

  it('비활성 계정은 OAuth callback에서도 세션·LOGIN 이력을 만들지 않는다', async () => {
    const flow = createFlowState();
    const res = createResponse();
    const issueSession = jest
      .fn()
      .mockRejectedValue(
        new DomainException(AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]),
      );

    await createController({ issueSession }).githubCallback(
      'synthetic-code',
      flow.state,
      undefined,
      requestWithCookie(`${flowCookieName(true)}=${encodeFlowCookie(flow)}`),
      res,
    );

    expect(recordLogin).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.arrayContaining([
        expect.stringContaining(`${sessionCookieName(true)}=`),
      ]),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://oss.example/?authError=1',
    );
  });
});

describe('AuthController getMe', () => {
  function createController(
    dbRole: Role | null,
    testRole: 'STAFF' | 'STUDENT' | 'ADMIN' | null,
  ): { controller: AuthController; resolveTestRole: jest.Mock } {
    const getMe = jest
      .fn()
      .mockResolvedValue({ ...syntheticUser, role: dbRole });
    const resolveTestRole = jest.fn().mockReturnValue(testRole);
    const controller = new AuthController(
      { getMe } as unknown as AuthService,
      { resolveTestRole } as unknown as AuthConfig,
      {} as LoginHistoryService,
    );
    return { controller, resolveTestRole };
  }

  const request = {
    sessionGithubId: syntheticUser.githubId,
  } as AuthenticatedRequest;

  it('정식 소스는 DB role이다 — TestRoleMap 미설정이면 DB role을 그대로 노출한다', async () => {
    const { controller, resolveTestRole } = createController(Role.ADMIN, null);

    const result = await controller.getMe(request);

    expect(result.role).toBe(Role.ADMIN);
    expect(result).toMatchObject({ nickname: 'synthetic-login' });
    expect(result).not.toHaveProperty('login');
    expect(result.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(resolveTestRole).toHaveBeenCalledWith(syntheticUser.githubId);
  });

  it('TestRoleMap(로컬 override)이 설정되면 DB role보다 우선한다', async () => {
    const { controller } = createController(Role.STUDENT, 'STAFF');

    const result = await controller.getMe(request);

    expect(result.role).toBe(Role.STAFF);
  });

  it('역할 선택 전(DB role=null)이고 TestRoleMap도 미설정이면 null이다', async () => {
    const { controller } = createController(null, null);

    const result = await controller.getMe(request);

    expect(result.role).toBeNull();
  });
});
