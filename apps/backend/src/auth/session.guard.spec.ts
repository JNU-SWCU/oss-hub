import { randomBytes } from 'node:crypto';
import { ExecutionContext } from '@nestjs/common';
import { SignJWT } from 'jose';
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
  response: { setHeader: jest.Mock };
} {
  const request = { headers: { cookie } } as AuthenticatedRequest;
  const response = { setHeader: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, response };
}

async function expectUnauthenticated(cookie?: string): Promise<void> {
  const authService = {
    getMe: jest.fn().mockResolvedValue({ id: 'synthetic-user' }),
  } as unknown as AuthService;
  const guard = new SessionGuard(buildConfig(), authService);
  const { context, response } = contextWithCookie(cookie);
  const act = guard.canActivate(context);
  await expect(act).rejects.toBeInstanceOf(DomainException);
  await expect(act).rejects.toMatchObject({
    errorCode: { code: AuthErrorCode.UNAUTHENTICATED, status: 401 },
  });
  expect(response.setHeader).toHaveBeenCalledWith(
    'Cache-Control',
    'private, no-store',
  );
}

describe('SessionGuard', () => {
  it('쿠키가 없으면 401 AUT_003을 던진다', async () => {
    await expectUnauthenticated(undefined);
  });

  it('malformed 토큰이면 401 AUT_003을 던진다', async () => {
    await expectUnauthenticated(`${sessionCookieName(true)}=not-a-jwt`);
  });

  it('서명이 일치하지 않는(변조) 토큰이면 401 AUT_003을 던진다', async () => {
    const otherSecret = new Uint8Array(randomBytes(32));
    const token = await issueSessionToken(otherSecret, syntheticGithubId);
    await expectUnauthenticated(`${sessionCookieName(true)}=${token}`);
  });

  it('expired 토큰이면 401 AUT_003을 던진다', async () => {
    const issuedAt =
      Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60;
    const token = await issueSessionToken(secret, syntheticGithubId, issuedAt);
    await expectUnauthenticated(`${sessionCookieName(true)}=${token}`);
  });

  it.each([
    ['issuer', 'other-issuer', 'oss-hub-web'],
    ['audience', 'oss-hub', 'other-audience'],
  ])(
    'wrong %s 토큰이면 generic 401을 반환한다',
    async (_, issuer, audience) => {
      // Given: 서명은 유효하지만 발급자 또는 대상이 다른 토큰이다.
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(syntheticGithubId.toString(10))
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(secret);

      // When: 보호 경계가 토큰을 해석한다.
      // Then: 어느 claim이 틀렸는지 노출하지 않고 동일한 401을 반환한다.
      await expectUnauthenticated(`${sessionCookieName(true)}=${token}`);
    },
  );

  it('유효한 세션이면 DB의 현재 계정·권한으로 active principal을 붙인다', async () => {
    const getMe = jest.fn().mockResolvedValue({
      id: 'synthetic-user',
      githubId: syntheticGithubId,
      role: 'STAFF',
    });
    const authService = {
      getMe,
    } as unknown as AuthService;
    const guard = new SessionGuard(buildConfig(), authService);
    const token = await issueSessionToken(secret, syntheticGithubId);
    const { context, request, response } = contextWithCookie(
      `${sessionCookieName(true)}=${token}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getMe).toHaveBeenCalledWith(syntheticGithubId);
    expect(request).toMatchObject({
      principal: {
        id: 'synthetic-user',
        githubId: syntheticGithubId,
        role: 'STAFF',
      },
      sessionGithubId: syntheticGithubId,
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
  });

  it('deactivated 계정은 유효한 토큰이어도 generic 401로 차단한다', async () => {
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
    const { context, response } = contextWithCookie(
      `${sessionCookieName(true)}=${token}`,
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      errorCode: { code: AuthErrorCode.UNAUTHENTICATED, status: 401 },
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
  });
});
