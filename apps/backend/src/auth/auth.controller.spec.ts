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
import { LoginHistoryService } from '../login-history/login-history.service';

const syntheticUser: AuthUser = {
  id: 'synthetic-id',
  githubId: 424242n,
  nickname: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  role: null,
  isProfileComplete: false,
};
/**
 * 온보딩을 끝낸 사용자 — 역할이 확정됐고 프로필도 완료됐다. 로그인 후 착지 지점이
 * 이 둘로 갈리므로, 랜딩으로 가는 경로를 검증하는 테스트는 이 픽스처를 써야 한다.
 */
const syntheticOnboardedUser: AuthUser = {
  ...syntheticUser,
  role: Role.STUDENT,
  isProfileComplete: true,
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
      .mockResolvedValue({ user: syntheticOnboardedUser, isNew: false }),
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

  // 회귀 방지: AUTH_INITIAL_ROLES는 계정 생성 시점에 역할을 채우므로
  // isNew=true와 role이 함께 오는 조합이 존재한다. role만으로 판정하면 이
  // 사용자가 동의·프로필 단계를 건너뛴다 — 동의는 개인정보 경계다.
  it('초기 역할이 설정된 신규 가입자도 동의 화면을 거친다', async () => {
    const flow = createFlowState();
    const res = createResponse();
    const completeLogin = jest
      .fn()
      .mockResolvedValue({ user: syntheticOnboardedUser, isNew: true });

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

  // 회귀 방지: 이전 구현은 `isNew`만 보고, 첫 로그인에서 온보딩을 끝내지 못한
  // 사용자를 두 번째 로그인부터 랜딩으로 떨어뜨렸다. 가입을 이어갈 경로가
  // 화면에 드러나지 않아 역할이 비어 있는 계정이 실제로 남았다.
  it('가입을 끝내지 못한 재로그인 사용자도 온보딩 입구로 되돌린다', async () => {
    const flow = createFlowState();
    const res = createResponse();
    const completeLogin = jest
      .fn()
      .mockResolvedValue({ user: syntheticUser, isNew: false });

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
