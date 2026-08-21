import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, type Response } from 'express';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import {
  OPTIONAL_SESSION_ROUTE_METADATA,
  PUBLIC_ROUTE_METADATA,
} from './auth-route-metadata';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { attachAnonymousAuth, attachAuthenticatedPrincipal } from './http-auth';
import { resolveSession } from './session-resolution';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AuthConfig,
    private readonly authService: AuthService,
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
    const { githubId, hasSessionCookie } = await resolveSession(
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
      if (principal === null) {
        attachAnonymousAuth(request, hasSessionCookie);
        return true;
      }
      attachAuthenticatedPrincipal(request, principal);
      return true;
    }

    if (githubId === null) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    const principal = await this.authService.getMe(githubId);
    attachAuthenticatedPrincipal(request, principal);
    return true;
  }
}
