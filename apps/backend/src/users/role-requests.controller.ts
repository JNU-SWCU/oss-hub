import { Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { MyStaffAccessRequestResponseDto } from './dto/my-staff-access-request-response.dto';
import { RoleRequestResponseDto } from './dto/role-request-response.dto';
import { MemberOnboardingService } from './member-onboarding.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('role-requests')
export class RoleRequestsController {
  constructor(
    @Inject(MemberOnboardingService)
    private readonly rolesService: Pick<
      MemberOnboardingService,
      'getMyRequest' | 'retryStaffRequest'
    >,
  ) {}

  @Get('me')
  @UseGuards(SessionGuard)
  async getMe(
    @Req() request: SessionIdentity,
  ): Promise<MyStaffAccessRequestResponseDto<RoleRequestResponseDto>> {
    const staffAccessRequest = await this.rolesService.getMyRequest(
      request.sessionGithubId,
    );
    return MyStaffAccessRequestResponseDto.from(
      staffAccessRequest
        ? RoleRequestResponseDto.from(staffAccessRequest)
        : null,
    );
  }

  @Post()
  @UseGuards(SessionGuard, OriginGuard)
  async retry(
    @Req() request: SessionIdentity,
  ): Promise<RoleRequestResponseDto> {
    const staffAccessRequest = await this.rolesService.retryStaffRequest(
      request.sessionGithubId,
    );
    return RoleRequestResponseDto.from(staffAccessRequest);
  }
}
