import { createFlowState, encodeFlowCookie } from './oauth-flow';
import { flowCookieName, sessionCookieName } from './cookies';
import {
  createController,
  createResponse,
  recordLogin,
  requestWithCookie,
  syntheticOnboardedUser,
  syntheticUser,
} from './auth.controller.spec.helpers';

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
});
