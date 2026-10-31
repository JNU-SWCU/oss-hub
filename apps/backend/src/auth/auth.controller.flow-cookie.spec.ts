import { DomainException } from '../platform/error-code.error';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.error';
import {
  createController,
  createResponse,
  recordLogin,
  requestWithCookie,
} from './auth.controller.spec.helpers';
import { AuthSessionService } from '../platform/auth-session.service';

const authSessionService = new AuthSessionService();

describe('AuthController github callback flow cookie contract', () => {
  beforeEach(() => {
    recordLogin.mockReset();
    recordLogin.mockResolvedValue(undefined);
  });

  it('OAuth denial은 state가 일치할 때만 flow cookie를 삭제한다', async () => {
    const flow = authSessionService.createFlowState();
    const res = createResponse();

    await createController().githubCallback(
      undefined,
      flow.state,
      'access_denied',
      requestWithCookie(
        `${authSessionService.flowCookieName(true)}=${authSessionService.encodeFlowCookie(flow)}`,
      ),
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      authSessionService.serializeCookie(
        authSessionService.flowCookieName(true),
        '',
        {
          maxAgeSeconds: 0,
          secure: true,
        },
      ),
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
    const flow = authSessionService.createFlowState();
    const res = createResponse();

    await createController().githubCallback(
      undefined,
      state,
      'access_denied',
      requestWithCookie(
        `${authSessionService.flowCookieName(true)}=${authSessionService.encodeFlowCookie(flow)}`,
      ),
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
    const flow = authSessionService.createFlowState();
    const res = createResponse();
    const completeLogin = jest
      .fn()
      .mockRejectedValue(new Error('invalid flow'));

    await createController({ completeLogin }).githubCallback(
      'synthetic-code',
      'x'.repeat(43),
      undefined,
      requestWithCookie(
        `${authSessionService.flowCookieName(true)}=${authSessionService.encodeFlowCookie(flow)}`,
      ),
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
    const flow = authSessionService.createFlowState();
    const res = createResponse();
    const completeLogin = jest
      .fn()
      .mockRejectedValue(new Error('provider failure'));

    await createController({ completeLogin }).githubCallback(
      'synthetic-code',
      flow.state,
      undefined,
      requestWithCookie(
        `${authSessionService.flowCookieName(true)}=${authSessionService.encodeFlowCookie(flow)}`,
      ),
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      authSessionService.serializeCookie(
        authSessionService.flowCookieName(true),
        '',
        {
          maxAgeSeconds: 0,
          secure: true,
        },
      ),
    );
  });

  it('비활성 계정은 OAuth callback에서도 세션·LOGIN 이력을 만들지 않는다', async () => {
    const flow = authSessionService.createFlowState();
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
      requestWithCookie(
        `${authSessionService.flowCookieName(true)}=${authSessionService.encodeFlowCookie(flow)}`,
      ),
      res,
    );

    expect(recordLogin).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalledWith(
      'Set-Cookie',
      expect.arrayContaining([
        expect.stringContaining(
          `${authSessionService.sessionCookieName(true)}=`,
        ),
      ]),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://oss.example/?authError=1',
    );
  });
});
