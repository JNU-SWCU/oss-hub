import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DomainException } from './error-code.error';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.error';
import { AuthConfig } from './auth.config';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (origin === this.config.allowedOrigin) {
      return true;
    }
    if (origin === undefined) {
      const referer = request.headers.referer;
      if (
        typeof referer === 'string' &&
        URL.canParse(referer) &&
        new URL(referer).origin === this.config.allowedOrigin
      ) {
        return true;
      }
    }
    throw new DomainException(AUTH_ERROR_CODES[AuthErrorCode.ORIGIN_FORBIDDEN]);
  }
}
