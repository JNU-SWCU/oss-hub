import { randomBytes } from 'node:crypto';
import { ExecutionContext } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import { SESSION_MAX_AGE_SECONDS, issueSessionToken } from './session-token';
import { AuthenticatedRequest, SessionGuard } from './session.guard';

const secret = new Uint8Array(randomBytes(32));
const syntheticGithubId = 424242n;

function buildConfig(sessionSecret: Uint8Array = secret): AuthConfig {
  return {
    useSecureCookies: true,
    sessionSecret,
  } as unknown as AuthConfig;
}

function contextWithCookie(cookie?: string): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = { headers: { cookie } } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

async function expectUnauthenticated(cookie?: string): Promise<void> {
  const authService = {
    getMe: jest.fn().mockResolvedValue({ id: 'synthetic-user' }),
  } as unknown as AuthService;
  const guard = new SessionGuard(buildConfig(), authService);
  const { context } = contextWithCookie(cookie);
  const act = guard.canActivate(context);
  await expect(act).rejects.toBeInstanceOf(DomainException);
  await expect(act).rejects.toMatchObject({
    errorCode: { code: AuthErrorCode.UNAUTHENTICATED, status: 401 },
  });
}

describe('SessionGuard', () => {
  it('쿠키가 없으면 401 AUT_003을 던진다', async () => {
    await expectUnauthenticated(undefined);
  });

  it('형식이 깨진 토큰이면 401 AUT_003을 던진다', async () => {
    await expectUnauthenticated(`${sessionCookieName(true)}=not-a-jwt`);
  });

  it('서명이 일치하지 않는(변조) 토큰이면 401 AUT_003을 던진다', async () => {
    const otherSecret = new Uint8Array(randomBytes(32));
    const token = await issueSessionToken(otherSecret, syntheticGithubId);
    await expectUnauthenticated(`${sessionCookieName(true)}=${token}`);
  });

  it('만료된 토큰이면 401 AUT_003을 던진다', async () => {
    const issuedAt =
      Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60;
    const token = await issueSessionToken(secret, syntheticGithubId, issuedAt);
    await expectUnauthenticated(`${sessionCookieName(true)}=${token}`);
  });

  it('유효한 세션이면 통과하고 요청에 sessionGithubId를 붙인다', async () => {
    const getMe = jest.fn().mockResolvedValue({ id: 'synthetic-user' });
    const authService = {
      getMe,
    } as unknown as AuthService;
    const guard = new SessionGuard(buildConfig(), authService);
    const token = await issueSessionToken(secret, syntheticGithubId);
    const { context, request } = contextWithCookie(
      `${sessionCookieName(true)}=${token}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getMe).toHaveBeenCalledWith(syntheticGithubId);
    expect(request.sessionGithubId).toBe(syntheticGithubId);
  });

  it('유효한 서명의 기존 토큰도 계정이 비활성화됐으면 즉시 401로 차단한다', async () => {
    const authService = {
      getMe: jest.fn().mockRejectedValue(
        new DomainException({
          code: AuthErrorCode.UNAUTHENTICATED,
          status: 401,
          message: '인증이 필요합니다.',
        }),
      ),
    } as unknown as AuthService;
    const guard = new SessionGuard(buildConfig(), authService);
    const token = await issueSessionToken(secret, syntheticGithubId);
    const { context } = contextWithCookie(
      `${sessionCookieName(true)}=${token}`,
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: AuthErrorCode.UNAUTHENTICATED, status: 401 },
    });
  });
});
