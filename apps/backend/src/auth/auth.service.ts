import { Injectable } from '@nestjs/common';
import {
  type LoginHistoryPage,
  type ActiveAccountPrincipal,
  type AuthLoginResult,
  type AuthUser,
  type GithubProfile,
} from './http-auth.types';
import { LOGIN_HISTORY_EVENTS, AuthConfig } from './auth.config';
import { LoginHistoryRepository, AuthRepository } from './auth.repository';
import { AccountStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.error';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
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

export interface CookieAttributes {
  maxAgeSeconds: number;
  secure: boolean;
}

export function serializeCookie(
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

export function serializeClearedSessionCookie(secure: boolean): string {
  return serializeCookie(sessionCookieName(secure), '', {
    maxAgeSeconds: 0,
    secure,
  });
}

export function flowCookieName(secure: boolean): string {
  return secure ? '__Host-oss_oauth_flow' : 'oss_oauth_flow_dev';
}

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-oss_session' : 'oss_session_dev';
}

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

@Injectable()
export class LoginHistoryService {
  constructor(private readonly repository: LoginHistoryRepository) {}

  async recordLogin(userId: string): Promise<void> {
    await this.repository.create(userId, LOGIN_HISTORY_EVENTS.LOGIN);
  }

  async recordLogout(userId: string): Promise<void> {
    await this.repository.create(userId, LOGIN_HISTORY_EVENTS.LOGOUT);
  }

  async findMine(
    userId: string,
    page: number,
    size: number,
  ): Promise<LoginHistoryPage> {
    return this.repository.findPage(userId, page, size);
  }
}

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_USER_EMAILS_URL = 'https://api.github.com/user/emails';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'oss-hub-backend';
const UPSTREAM_TIMEOUT_MS = 10_000;
const GITHUB_OAUTH_SCOPE = 'read:user user:email';

export interface AuthorizeRedirect {
  url: string;
  flowCookieValue: string;
}

export interface CompleteLoginInput {
  code: string;
  state: string;
  flowCookie: string | undefined;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly config: AuthConfig,
    private readonly repository: AuthRepository,
  ) {}

  buildAuthorizeRedirect(prompt?: 'select_account'): AuthorizeRedirect {
    const oauth = this.config.requireOauth();
    const flow = createFlowState();
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set('client_id', oauth.clientId);
    url.searchParams.set('redirect_uri', oauth.callbackUrl);
    url.searchParams.set('scope', GITHUB_OAUTH_SCOPE);
    url.searchParams.set('state', flow.state);
    url.searchParams.set('code_challenge', toCodeChallenge(flow.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    if (prompt === 'select_account') {
      url.searchParams.set('prompt', prompt);
    }
    return { url: url.toString(), flowCookieValue: encodeFlowCookie(flow) };
  }

  async completeLogin(input: CompleteLoginInput): Promise<AuthLoginResult> {
    const flow = decodeFlowCookie(input.flowCookie);
    if (!flow || !isSameState(flow.state, input.state)) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.OAUTH_FLOW_INVALID],
      );
    }
    const accessToken = await this.exchangeCode(input.code, flow.verifier);
    const profile = await this.fetchProfile(accessToken);
    return this.repository.withTransaction((store) =>
      store.upsertUser(profile),
    );
  }

  async issueSession(user: AuthUser): Promise<string> {
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return issueSessionToken(
      this.config.sessionSecret,
      user.githubId,
      user.sessionVersion,
    );
  }

  async getMe(githubId: bigint): Promise<ActiveAccountPrincipal> {
    const principal = await this.findActivePrincipal(githubId);
    if (principal === null) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    return principal;
  }

  async findActivePrincipal(
    githubId: bigint,
  ): Promise<ActiveAccountPrincipal | null> {
    const user = await this.repository.findByGithubId(githubId);
    if (user?.accountStatus !== AccountStatus.ACTIVE) {
      return null;
    }
    return { ...user, accountStatus: AccountStatus.ACTIVE };
  }

  async findMe(githubId: bigint): Promise<AuthUser | null> {
    return this.repository.findByGithubId(githubId);
  }

  async incrementSessionVersion(githubId: bigint): Promise<void> {
    await this.repository.incrementSessionVersion(githubId);
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    const oauth = this.config.requireOauth();
    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        redirect_uri: oauth.callbackUrl,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`GitHub code 교환 실패 (HTTP ${response.status})`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const accessToken = body.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('GitHub code 교환 응답에 access_token이 없습니다.');
    }
    return accessToken;
  }

  private async fetchProfile(accessToken: string): Promise<GithubProfile> {
    const response = await fetch(GITHUB_USER_URL, {
      headers: this.githubApiHeaders(accessToken),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`GitHub 프로필 조회 실패 (HTTP ${response.status})`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.id !== 'number' || typeof body.login !== 'string') {
      throw new Error('GitHub 프로필 응답 형식이 올바르지 않습니다.');
    }
    const email = await this.fetchPrimaryEmail(accessToken);
    return {
      githubId: BigInt(body.id),
      login: body.login,
      name: typeof body.name === 'string' ? body.name : null,
      avatarUrl: typeof body.avatar_url === 'string' ? body.avatar_url : null,
      email,
    };
  }

  private async fetchPrimaryEmail(accessToken: string): Promise<string | null> {
    const response = await fetch(GITHUB_USER_EMAILS_URL, {
      headers: this.githubApiHeaders(accessToken),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      return null;
    }
    const emails = body.flatMap((entry) => {
      if (
        entry === null ||
        typeof entry !== 'object' ||
        typeof (entry as { email?: unknown }).email !== 'string' ||
        typeof (entry as { primary?: unknown }).primary !== 'boolean' ||
        typeof (entry as { verified?: unknown }).verified !== 'boolean'
      ) {
        return [];
      }
      const row = entry as {
        email: string;
        primary: boolean;
        verified: boolean;
      };
      return [
        {
          email: row.email,
          primary: row.primary,
          verified: row.verified,
        },
      ];
    });
    return selectGithubPrimaryEmail(emails);
  }

  private githubApiHeaders(accessToken: string): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
  }
}
