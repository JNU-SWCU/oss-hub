import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { requireValidUserId } from './admin-access.controller';
import { IndependentAuthorityMutationResponseDto } from './dto/admin-access-response.dto';
import {
  PatchAdminAuthorityRequestDto,
  PatchStaffAccessRequestDto,
} from './dto/patch-independent-authority.dto';
import { IndependentAuthorityService } from './independent-authority.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users')
export class IndependentAuthorityController {
  constructor(
    @Inject(IndependentAuthorityService)
    private readonly service: Pick<
      IndependentAuthorityService,
      'patchStaffAccess' | 'patchAdminAccess'
    >,
  ) {}

  @Patch(':id/staff-access')
  @UseGuards(SessionGuard, OriginGuard)
  async patchStaffAccess(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchStaffAccessRequestDto,
  ): Promise<IndependentAuthorityMutationResponseDto> {
    requireValidUserId(id);
    return IndependentAuthorityMutationResponseDto.from(
      await this.service.patchStaffAccess(
        request.sessionGithubId,
        id,
        body.toCommand(),
      ),
    );
  }

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
