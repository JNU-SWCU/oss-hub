import type { AuthUser } from './http-auth.types';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AuthConfig } from './auth.config';
import { parseCookies, sessionCookieName } from './cookies.policy';

export interface GithubEmailEntry {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export function selectGithubPrimaryEmail(
  emails: readonly GithubEmailEntry[],
): string | null {
  const primaryVerified = emails.find(
    (entry) => entry.primary && entry.verified,
  );
  if (primaryVerified) {
    return primaryVerified.email;
  }
  const primary = emails.find((entry) => entry.primary);
  if (primary) {
    return primary.email;
  }
  const verified = emails.find((entry) => entry.verified);
  return verified?.email ?? null;
}

const ONBOARDING_ENTRY_PATH = '/consent';

export function loginLandingUrl(
  frontendUrl: string,
  login: {
    readonly user: Pick<
      AuthUser,
      'memberKind' | 'hasStaffAccess' | 'hasAdminAccess' | 'isProfileComplete'
    >;
    readonly isNew: boolean;
  },
): string {
  const needsOnboarding =
    login.isNew ||
    !hasAssignedAccess(login.user) ||
    !login.user.isProfileComplete;
  return needsOnboarding
    ? `${frontendUrl}${ONBOARDING_ENTRY_PATH}`
    : frontendUrl;
}

function hasAssignedAccess(
  user: Pick<AuthUser, 'memberKind' | 'hasStaffAccess' | 'hasAdminAccess'>,
): boolean {
  return (
    user.memberKind === 'STUDENT' || user.hasStaffAccess || user.hasAdminAccess
  );
}

export interface OauthFlowState {
  state: string;
  verifier: string;
}

const SEGMENT_RE = /^[A-Za-z0-9_-]{43}$/;

export function createFlowState(): OauthFlowState {
  return {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
  };
}

export function encodeFlowCookie(flow: OauthFlowState): string {
  return `${flow.state}.${flow.verifier}`;
}

export function decodeFlowCookie(
  value: string | undefined,
): OauthFlowState | null {
  if (!value) {
    return null;
  }
  const segments = value.split('.');
  if (segments.length !== 2) {
    return null;
  }
  const [state, verifier] = segments;
  if (state === undefined || verifier === undefined) {
    return null;
  }
  if (!SEGMENT_RE.test(state) || !SEGMENT_RE.test(verifier)) {
    return null;
  }
  return { state, verifier };
}

export function isSameState(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function toCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const ISSUER = 'oss-hub';
const AUDIENCE = 'oss-hub-web';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const SUB_RE = /^[0-9]{1,19}$/;

export interface VerifiedSessionToken {
  readonly githubId: bigint;
  readonly sessionVersion: number;
}

function assertSessionVersion(sessionVersion: number): void {
  if (!Number.isInteger(sessionVersion) || sessionVersion < 0) {
    throw new TypeError('sessionVersion must be a nonnegative integer');
  }
}

export async function issueSessionToken(
  secret: Uint8Array,
  githubId: bigint,
  sessionVersion: number,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  assertSessionVersion(sessionVersion);
  return new SignJWT({ sessionVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(githubId.toString(10))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowEpochSeconds)
    .setExpirationTime(nowEpochSeconds + SESSION_MAX_AGE_SECONDS)
    .sign(secret);
}

export async function verifySessionToken(
  secret: Uint8Array,
  token: string,
): Promise<VerifiedSessionToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['sub', 'iat', 'exp', 'sessionVersion'],
      clockTolerance: 5,
    });
    const { sub, iat, exp, sessionVersion } = payload;
    if (typeof sub !== 'string' || !SUB_RE.test(sub)) {
      return null;
    }
    if (typeof iat !== 'number' || typeof exp !== 'number') {
      return null;
    }
    if (exp - iat > SESSION_MAX_AGE_SECONDS) {
      return null;
    }
    if (
      typeof sessionVersion !== 'number' ||
      !Number.isInteger(sessionVersion) ||
      sessionVersion < 0
    ) {
      return null;
    }
    return { githubId: BigInt(sub), sessionVersion };
  } catch {
    return null;
  }
}

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
