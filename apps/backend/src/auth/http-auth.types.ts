import type { AccountStatus, MemberKind } from '@prisma/client';
import type { Request } from 'express';
import type {
  LOGIN_HISTORY_EVENTS,
  LOGIN_HISTORY_PROVIDER,
  HTTP_AUTH_KINDS,
} from '../platform/auth.config';

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

export type LoginHistoryEvent =
  (typeof LOGIN_HISTORY_EVENTS)[keyof typeof LOGIN_HISTORY_EVENTS];

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
