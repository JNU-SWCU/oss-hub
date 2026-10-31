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
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import {
  RoleSelectionResponseDto,
  MemberKindSelectionStateResponseDto,
} from './dto/role-selection-response.dto';
import { SelectRoleRequestDto } from './dto/select-role-request.dto';
import { MemberOnboardingService } from './member-onboarding.service';
import { Protected } from '../auth/authentication.guard';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(MemberOnboardingService)
    private readonly rolesService: Pick<
      MemberOnboardingService,
      'selectMemberKind' | 'getMySelection' | 'memberKindFromRequest'
    >,
  ) {}

  @Get('role')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async getMySelection(
    @Req() request: SessionIdentity,
  ): Promise<MemberKindSelectionStateResponseDto> {
    return MemberKindSelectionStateResponseDto.from(
      await this.rolesService.getMySelection(request.sessionGithubId),
    );
  }

  @Post('role')
  @Protected()
  @UseGuards(OriginGuard)
  async selectRole(
    @Req() request: SessionIdentity,
    @Body() body: SelectRoleRequestDto,
  ): Promise<RoleSelectionResponseDto> {
    const result = await this.rolesService.selectMemberKind(
      request.sessionGithubId,
      this.rolesService.memberKindFromRequest(body),
    );
    return RoleSelectionResponseDto.from(result);
  }
}
