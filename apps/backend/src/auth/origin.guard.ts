import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';

/**
 * 쓰기 엔드포인트용 Origin 검사 — SameSite=Lax의 보조 방어선.
 * Origin 헤더가 없는 요청(브라우저 밖 도구)은 통과시키고, 있으면 허용 origin만 받는다.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== this.config.allowedOrigin) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.ORIGIN_FORBIDDEN],
      );
    }
    return true;
  }
}
