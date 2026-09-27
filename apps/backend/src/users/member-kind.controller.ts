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
import { PatchMemberKindRequestDto } from './dto/patch-member-kind.dto';
import { MemberKindService } from './member-kind.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users')
export class MemberKindController {
  constructor(
    @Inject(MemberKindService)
    private readonly service: Pick<MemberKindService, 'patchMemberKind'>,
  ) {}

  @Patch(':id/member-kind')
  @UseGuards(SessionGuard, OriginGuard)
  async patchMemberKind(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchMemberKindRequestDto,
  ): Promise<IndependentAuthorityMutationResponseDto> {
    requireValidUserId(id);
    return IndependentAuthorityMutationResponseDto.from(
      await this.service.patchMemberKind(
        request.sessionGithubId,
        id,
        body.toCommand(),
      ),
    );
  }
}
