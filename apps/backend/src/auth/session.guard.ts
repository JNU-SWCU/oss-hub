import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';
import { parseCookies, sessionCookieName } from './cookies';
import { verifySessionToken } from './session-token';

export interface AuthenticatedRequest extends Request {
  sessionGithubId: bigint;
}

/** 세션 쿠키를 검증해 요청에 githubId를 붙인다. 실패는 전부 동일한 AUT_003. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly config: AuthConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[sessionCookieName(this.config.useSecureCookies)];
    const githubId = token
      ? await verifySessionToken(this.config.sessionSecret, token)
      : null;
    if (githubId === null) {
      throw new DomainException(AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]);
    }
    (request as AuthenticatedRequest).sessionGithubId = githubId;
    return true;
  }
}
