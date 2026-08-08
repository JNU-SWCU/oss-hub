import {
  Controller,
  Header,
  Inject,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthConfig } from '../auth/auth.config';
import { serializeClearedSessionCookie } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AccountDeactivationService } from './account-deactivation.service';
import { AccountDeactivationResponseDto } from './dto/account-deactivation-response.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/account')
export class AccountDeactivationController {
  constructor(
    @Inject(AccountDeactivationService)
    private readonly service: Pick<AccountDeactivationService, 'deactivate'>,
    private readonly authConfig: AuthConfig,
  ) {}

  @Patch('deactivate')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, OriginGuard)
  async deactivate(
    @Req() request: SessionIdentity,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccountDeactivationResponseDto> {
    const result = await this.service.deactivate(request.sessionGithubId);
    response.setHeader(
      'Set-Cookie',
      serializeClearedSessionCookie(this.authConfig.useSecureCookies),
    );
    return new AccountDeactivationResponseDto(result);
  }
}
