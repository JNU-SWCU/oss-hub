import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';

/**
 * 쓰기 엔드포인트용 Origin 검사 — SameSite=Lax의 보조 방어선.
 * exact Origin 또는 exact-origin Referer만 허용하고 증명할 수 없는 요청은 거부한다.
 */
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
