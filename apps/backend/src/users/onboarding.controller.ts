import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import {
  RoleSelectionResponseDto,
  MemberKindSelectionStateResponseDto,
} from './dto/role-selection-response.dto';
import { SelectRoleRequestDto } from './dto/select-role-request.dto';
import { MemberOnboardingService } from './member-onboarding.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(MemberOnboardingService)
    private readonly rolesService: Pick<
      MemberOnboardingService,
      'selectMemberKind' | 'getMySelection'
    >,
  ) {}

  @Get('role')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async getMySelection(
    @Req() request: SessionIdentity,
  ): Promise<MemberKindSelectionStateResponseDto> {
    return MemberKindSelectionStateResponseDto.from(
      await this.rolesService.getMySelection(request.sessionGithubId),
    );
  }

  @Post('role')
  @UseGuards(SessionGuard, OriginGuard)
  async selectRole(
    @Req() request: SessionIdentity,
    @Body() body: SelectRoleRequestDto,
  ): Promise<RoleSelectionResponseDto> {
    const result = await this.rolesService.selectMemberKind(
      request.sessionGithubId,
      body.toMemberKind(),
    );
    return RoleSelectionResponseDto.from(result);
  }
}
