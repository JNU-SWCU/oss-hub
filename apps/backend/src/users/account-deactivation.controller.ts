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
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { AccountDeactivationService } from './account-deactivation.service';
import { AccountDeactivationResponseDto } from './dto/account-deactivation-response.dto';
import { Protected } from '../auth/auth-route.decorator';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/account')
export class AccountDeactivationController {
  constructor(
    @Inject(AccountDeactivationService)
    private readonly service: Pick<
      AccountDeactivationService,
      'deactivateAndClearSession'
    >,
  ) {}

  @Patch('deactivate')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  @UseGuards(OriginGuard)
  async deactivate(
    @Req() request: SessionIdentity,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccountDeactivationResponseDto> {
    return AccountDeactivationResponseDto.from(
      await this.service.deactivateAndClearSession(
        request.sessionGithubId,
        response,
      ),
    );
  }
}
