import { randomBytes } from 'node:crypto';
import { ExecutionContext } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';
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
  const guard = new SessionGuard(buildConfig());
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
    const guard = new SessionGuard(buildConfig());
    const token = await issueSessionToken(secret, syntheticGithubId);
    const { context, request } = contextWithCookie(
      `${sessionCookieName(true)}=${token}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.sessionGithubId).toBe(syntheticGithubId);
  });
});
