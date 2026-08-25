import { AuthConfig } from './auth.config';
import { parseCookies, sessionCookieName } from './cookies';
import { verifySessionToken } from './session-token';

export type SessionResolution =
  | {
      readonly githubId: null;
      readonly sessionVersion: null;
      readonly hasSessionCookie: boolean;
    }
  | {
      readonly githubId: bigint;
      readonly sessionVersion: number;
      readonly hasSessionCookie: true;
    };

/** 보호 경로와 UI용 상태 조회가 공유하는 세션 해석 경로. */
export async function resolveSession(
  config: AuthConfig,
  cookieHeader: string | undefined,
): Promise<SessionResolution> {
  const cookies = parseCookies(cookieHeader);
  const token = cookies[sessionCookieName(config.useSecureCookies)];
  if (token === undefined) {
    return {
      githubId: null,
      sessionVersion: null,
      hasSessionCookie: false,
    };
  }
  const verified = await verifySessionToken(config.sessionSecret, token);
  if (verified === null) {
    return {
      githubId: null,
      sessionVersion: null,
      hasSessionCookie: true,
    };
  }
  return {
    githubId: verified.githubId,
    sessionVersion: verified.sessionVersion,
    hasSessionCookie: true,
  };
}
