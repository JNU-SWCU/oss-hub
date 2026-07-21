import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { DomainException } from '../common/error-code';
import { AUTH_ERROR_CODES, AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { resolveSession } from './session-resolution';

export interface AuthenticatedRequest extends Request {
  sessionGithubId: bigint;
}

/** 세션 쿠키를 검증해 요청에 githubId를 붙인다. 실패는 전부 동일한 AUT_003. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly config: AuthConfig,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const { githubId } = await resolveSession(
      this.config,
      request.headers.cookie,
    );
    if (githubId === null) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    await this.authService.getMe(githubId);
    (request as AuthenticatedRequest).sessionGithubId = githubId;
    return true;
  }
}
