import { Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { MyStaffAccessRequestResponseDto } from './dto/my-staff-access-request-response.dto';
import { StaffAccessRequestResponseDto } from './dto/role-request-response.dto';
import { RolesService } from './member-onboarding.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('role-requests')
export class StaffAccessRequestsController {
  constructor(
    @Inject(RolesService)
    private readonly rolesService: Pick<
      RolesService,
      'getMyRequest' | 'retryStaffRequest'
    >,
  ) {}

  @Get('me')
  @UseGuards(SessionGuard)
  async getMe(
    @Req() request: SessionIdentity,
  ): Promise<MyStaffAccessRequestResponseDto<StaffAccessRequestResponseDto>> {
    const staffAccessRequest = await this.rolesService.getMyRequest(
      request.sessionGithubId,
    );
    return MyStaffAccessRequestResponseDto.from(
      staffAccessRequest
        ? StaffAccessRequestResponseDto.from(staffAccessRequest)
        : null,
    );
  }

  @Post()
  @UseGuards(SessionGuard, OriginGuard)
  async retry(
    @Req() request: SessionIdentity,
  ): Promise<StaffAccessRequestResponseDto> {
    const staffAccessRequest = await this.rolesService.retryStaffRequest(
      request.sessionGithubId,
    );
    return StaffAccessRequestResponseDto.from(staffAccessRequest);
  }
}
