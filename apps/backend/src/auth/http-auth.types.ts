import { AccountStatus, MemberKind } from '@prisma/client';
import type { Request } from 'express';

export interface AuthUser {
  readonly id: string;
  readonly githubId: bigint;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly accountStatus: AccountStatus;
  readonly sessionVersion: number;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;

  readonly isProfileComplete: boolean;
}

export interface ActiveAccountPrincipal extends AuthUser {
  readonly accountStatus: typeof AccountStatus.ACTIVE;
}

export interface AuthLoginResult {
  user: AuthUser;
  isNew: boolean;
}

export interface GithubProfile {
  githubId: bigint;
  login: string;
  name: string | null;
  avatarUrl: string | null;

  email: string | null;
}

export const LOGIN_HISTORY_EVENTS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
} as const;

export type LoginHistoryEvent =
  (typeof LOGIN_HISTORY_EVENTS)[keyof typeof LOGIN_HISTORY_EVENTS];

export const LOGIN_HISTORY_PROVIDER = 'github' as const;

export type LoginHistory = {
  readonly id: string;
  readonly event: LoginHistoryEvent;
  readonly provider: typeof LOGIN_HISTORY_PROVIDER;
  readonly success: boolean;
  readonly loginAt: Date;
};

export type LoginHistoryPage = {
  readonly items: readonly LoginHistory[];
  readonly page: number;
  readonly size: number;
  readonly total: number;
};

export const HTTP_AUTH_KINDS = {
  ANONYMOUS: 'ANONYMOUS',
  AUTHENTICATED: 'AUTHENTICATED',
} as const;

interface AnonymousHttpAuth {
  readonly kind: typeof HTTP_AUTH_KINDS.ANONYMOUS;
  readonly hasSessionCookie: boolean;
}

interface AuthenticatedHttpAuth {
  readonly kind: typeof HTTP_AUTH_KINDS.AUTHENTICATED;
  readonly hasSessionCookie: true;
  readonly principal: ActiveAccountPrincipal;
}

type HttpAuth = AnonymousHttpAuth | AuthenticatedHttpAuth;

export interface OptionalSessionRequest extends Request {
  readonly auth: HttpAuth;
}

export interface AuthenticatedRequest extends Request {
  readonly auth: AuthenticatedHttpAuth;
  readonly principal: ActiveAccountPrincipal;
  sessionGithubId: bigint;
}

export function assertNeverHttpAuth(auth: never): never {
  throw new TypeError(`Unexpected HTTP authentication kind: ${String(auth)}`);
}

export function attachAnonymousAuth(
  request: Request,
  hasSessionCookie: boolean,
): void {
  Object.assign(request, {
    auth: {
      kind: HTTP_AUTH_KINDS.ANONYMOUS,
      hasSessionCookie,
    },
  });
}

export function attachAuthenticatedPrincipal(
  request: Request,
  principal: ActiveAccountPrincipal,
  verifiedGithubId: bigint,
): void {
  Object.assign(request, {
    auth: {
      kind: HTTP_AUTH_KINDS.AUTHENTICATED,
      hasSessionCookie: true,
      principal,
    },
    principal,
    sessionGithubId: verifiedGithubId,
  });
}
