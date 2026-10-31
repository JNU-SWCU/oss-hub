import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { DomainException } from '../platform/error-code.error';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.error';
import { AuthConfig, HTTP_AUTH_KINDS } from './auth.config';
import { AuthService } from './auth.service';

import type { ActiveAccountPrincipal } from './http-auth.types';
import { AuthSessionService } from './auth-session.service';

export const AUTH_ROUTE_ACCESS = {
  PUBLIC: 'PUBLIC',
  OPTIONAL_SESSION: 'OPTIONAL_SESSION',
  PROTECTED: 'PROTECTED',
} as const;

export type AuthRouteAccess =
  (typeof AUTH_ROUTE_ACCESS)[keyof typeof AUTH_ROUTE_ACCESS];

export const PUBLIC_ROUTE_METADATA = Symbol('public-route');

export const OPTIONAL_SESSION_ROUTE_METADATA = Symbol('optional-session-route');

export const PROTECTED_ROUTE_METADATA = Symbol('protected-route');

type AuthRouteDecorator = ClassDecorator & MethodDecorator;

export function Public(): AuthRouteDecorator {
  return SetMetadata(PUBLIC_ROUTE_METADATA, true);
}

export function OptionalSession(): AuthRouteDecorator {
  return SetMetadata(OPTIONAL_SESSION_ROUTE_METADATA, true);
}

export function Protected(): AuthRouteDecorator {
  return SetMetadata(PROTECTED_ROUTE_METADATA, true);
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AuthConfig,
    private readonly authService: AuthService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadataTargets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(
        PUBLIC_ROUTE_METADATA,
        metadataTargets,
      ) === true
    ) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    http
      .getResponse<Response | undefined>()
      ?.setHeader('Cache-Control', 'private, no-store');
    const { githubId, sessionVersion, hasSessionCookie } =
      await this.authSessionService.resolveSession(
        this.config,
        request.headers.cookie,
      );
    const optionalSession =
      this.reflector.getAllAndOverride<boolean>(
        OPTIONAL_SESSION_ROUTE_METADATA,
        metadataTargets,
      ) === true;

    if (optionalSession) {
      if (githubId === null) {
        attachAnonymousAuth(request, hasSessionCookie);
        return true;
      }
      const principal = await this.authService.findActivePrincipal(githubId);
      if (principal === null || principal.sessionVersion !== sessionVersion) {
        attachAnonymousAuth(request, hasSessionCookie);
        return true;
      }
      attachAuthenticatedPrincipal(request, principal, githubId);
      return true;
    }

    if (githubId === null) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    const principal = await this.authService.getMe(githubId);
    if (principal.sessionVersion !== sessionVersion) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    attachAuthenticatedPrincipal(request, principal, githubId);
    return true;
  }
}

export function assertNeverHttpAuth(auth: never): never {
  throw new TypeError(`Unexpected HTTP authentication kind: ${String(auth)}`);
}

function attachAnonymousAuth(
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

function attachAuthenticatedPrincipal(
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
