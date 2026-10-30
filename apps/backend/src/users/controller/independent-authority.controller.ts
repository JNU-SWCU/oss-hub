import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/origin.guard';
import type { AuthenticatedRequest } from '../../auth/http-auth.types';
import { SessionGuard } from '../../auth/session.guard';
import { requireValidUserId } from '../domain/user-id';
import { IndependentAuthorityMutationResponseDto } from '../dto/admin-access-response.dto';
import { PatchAdminAuthorityRequestDto } from '../dto/patch-independent-authority.dto';
import { IndependentAuthorityService } from '../service/independent-authority.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users')
export class IndependentAuthorityController {
  constructor(
    @Inject(IndependentAuthorityService)
    private readonly service: Pick<
      IndependentAuthorityService,
      'patchAdminAccess'
    >,
  ) {}

  @Patch(':id/admin-access')
  @UseGuards(SessionGuard, OriginGuard)
  async patchAdminAccess(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchAdminAuthorityRequestDto,
  ): Promise<IndependentAuthorityMutationResponseDto> {
    requireValidUserId(id);
    return IndependentAuthorityMutationResponseDto.from(
      await this.service.patchAdminAccess(
        request.sessionGithubId,
        id,
        body.toCommand(),
      ),
    );
  }
}
