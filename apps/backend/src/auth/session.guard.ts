import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, type Response } from 'express';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { attachAuthenticatedPrincipal } from './http-auth';
import { resolveSession } from './session-resolution';

export type { AuthenticatedRequest } from './http-auth';

/** 세션 쿠키를 검증해 요청에 active principal을 붙인다. 실패는 전부 동일한 AUT_003. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly config: AuthConfig,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    http
      .getResponse<Response | undefined>()
      ?.setHeader('Cache-Control', 'private, no-store');
    const { githubId, sessionVersion } = await resolveSession(
      this.config,
      request.headers.cookie,
    );
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
