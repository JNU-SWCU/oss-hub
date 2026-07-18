import { Request, Response } from 'express';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { flowCookieName, serializeCookie } from './cookies';
import { AuthUser } from './domain/auth-user';
import { createFlowState, encodeFlowCookie } from './oauth-flow';
import { AuthenticatedRequest } from './session.guard';

const syntheticUser: AuthUser = {
  id: 'synthetic-id',
  githubId: 424242n,
  login: 'synthetic-login',
  name: null,
  avatarUrl: null,
};

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
    completeLogin: jest.fn().mockResolvedValue(syntheticUser),
    issueSession: jest.fn().mockResolvedValue('synthetic-session'),
    ...serviceOverrides,
  } as unknown as AuthService;
  const config = {
    frontendUrl: 'https://oss.example',
    useSecureCookies: true,
  } as AuthConfig;
  return new AuthController(service, config);
}

function requestWithCookie(cookie?: string): Request {
  return {
    headers: { cookie },
    path: '/api/v1/auth/github/callback',
  } as Request;
}

describe('AuthController github callback', () => {
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
});

describe('AuthController getMe', () => {
  it('테스트 역할 매핑을 응답에 포함하고, 미등록은 null이다', async () => {
    const getMe = jest.fn().mockResolvedValue(syntheticUser);
    const resolveTestRole = jest.fn().mockReturnValue('STAFF');
    const controller = new AuthController(
      { getMe } as unknown as AuthService,
      { resolveTestRole } as unknown as AuthConfig,
    );
    const request = {
      sessionGithubId: syntheticUser.githubId,
    } as AuthenticatedRequest;

    const withRole = await controller.getMe(request);
    expect(withRole.role).toBe('STAFF');
    expect(withRole.login).toBe('synthetic-login');
    expect(resolveTestRole).toHaveBeenCalledWith(syntheticUser.githubId);

    resolveTestRole.mockReturnValue(null);
    const withoutRole = await controller.getMe(request);
    expect(withoutRole.role).toBeNull();
  });
});
