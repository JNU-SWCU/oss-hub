import { Injectable } from '@nestjs/common';
import type { AuthUser } from './http-auth.types';
import { AuthConfig } from './auth.config';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

@Injectable()
export class AuthSessionService {
  parseCookies(header: string | undefined): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!header) {
      return cookies;
    }
    for (const part of header.split(';')) {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex < 0) {
        continue;
      }
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (name && !(name in cookies)) {
        cookies[name] = value;
      }
    }
    return cookies;
  }

  serializeCookie(
    name: string,
    value: string,
    attributes: CookieAttributes,
  ): string {
    const parts = [
      `${name}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${attributes.maxAgeSeconds}`,
    ];
    if (attributes.secure) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  serializeClearedSessionCookie(secure: boolean): string {
    return this.serializeCookie(this.sessionCookieName(secure), '', {
      maxAgeSeconds: 0,
      secure,
    });
  }

  flowCookieName(secure: boolean): string {
    return secure ? '__Host-oss_oauth_flow' : 'oss_oauth_flow_dev';
  }

  sessionCookieName(secure: boolean): string {
    return secure ? '__Host-oss_session' : 'oss_session_dev';
  }

  selectGithubPrimaryEmail(emails: readonly GithubEmailEntry[]): string | null {
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

  loginLandingUrl(
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

  createFlowState(): OauthFlowState {
    return {
      state: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
    };
  }

  encodeFlowCookie(flow: OauthFlowState): string {
    return `${flow.state}.${flow.verifier}`;
  }

  decodeFlowCookie(value: string | undefined): OauthFlowState | null {
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

  isSameState(expected: string, received: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  }

  toCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  async issueSessionToken(
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

  async verifySessionToken(
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

  async resolveSession(
    config: AuthConfig,
    cookieHeader: string | undefined,
  ): Promise<SessionResolution> {
    const cookies = this.parseCookies(cookieHeader);
    const token = cookies[this.sessionCookieName(config.useSecureCookies)];
    if (token === undefined) {
      return {
        githubId: null,
        sessionVersion: null,
        hasSessionCookie: false,
      };
    }
    const verified = await this.verifySessionToken(config.sessionSecret, token);
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
}

const ONBOARDING_ENTRY_PATH = '/consent';

function hasAssignedAccess(
  user: Pick<AuthUser, 'memberKind' | 'hasStaffAccess' | 'hasAdminAccess'>,
): boolean {
  return (
    user.memberKind === 'STUDENT' || user.hasStaffAccess || user.hasAdminAccess
  );
}

const SEGMENT_RE = /^[A-Za-z0-9_-]{43}$/;

const ISSUER = 'oss-hub';

const AUDIENCE = 'oss-hub-web';

const SUB_RE = /^[0-9]{1,19}$/;

function assertSessionVersion(sessionVersion: number): void {
  if (!Number.isInteger(sessionVersion) || sessionVersion < 0) {
    throw new TypeError('sessionVersion must be a nonnegative integer');
  }
}

export interface CookieAttributes {
  maxAgeSeconds: number;
  secure: boolean;
}

export interface GithubEmailEntry {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export interface OauthFlowState {
  state: string;
  verifier: string;
}

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface VerifiedSessionToken {
  readonly githubId: bigint;
  readonly sessionVersion: number;
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
