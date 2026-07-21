import { AuthConfig } from './auth.config';
import { parseCookies, sessionCookieName } from './cookies';
import { verifySessionToken } from './session-token';

export interface SessionResolution {
  readonly githubId: bigint | null;
  readonly hasSessionCookie: boolean;
}

/** 보호 경로와 UI용 상태 조회가 공유하는 세션 해석 경로. */
export async function resolveSession(
  config: AuthConfig,
  cookieHeader: string | undefined,
): Promise<SessionResolution> {
  const cookies = parseCookies(cookieHeader);
  const token = cookies[sessionCookieName(config.useSecureCookies)];
  const githubId = token
    ? await verifySessionToken(config.sessionSecret, token)
    : null;
  return { githubId, hasSessionCookie: token !== undefined };
}
