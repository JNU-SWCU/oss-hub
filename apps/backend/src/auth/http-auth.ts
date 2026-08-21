import type { Request } from 'express';
import type { ActiveAccountPrincipal } from './domain/auth-user';

export const HTTP_AUTH_KINDS = {
  ANONYMOUS: 'ANONYMOUS',
  AUTHENTICATED: 'AUTHENTICATED',
} as const;

export interface AnonymousHttpAuth {
  readonly kind: typeof HTTP_AUTH_KINDS.ANONYMOUS;
  readonly hasSessionCookie: boolean;
}

export interface AuthenticatedHttpAuth {
  readonly kind: typeof HTTP_AUTH_KINDS.AUTHENTICATED;
  readonly hasSessionCookie: true;
  readonly principal: ActiveAccountPrincipal;
}

export type HttpAuth = AnonymousHttpAuth | AuthenticatedHttpAuth;

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
