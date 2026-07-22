import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { PatchStaffRoleRequestDto } from './dto/patch-staff-role-request.dto';
import {
  StaffRoleRequestListResponseDto,
  StaffRoleRequestResponseDto,
} from './dto/staff-role-request-response.dto';
import { StaffRoleRequestsQueryRequestDto } from './dto/staff-role-requests-query.dto';
import { StaffRoleRequestsService } from './staff-role-requests.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('role-requests')
export class StaffRoleRequestsController {
  constructor(
    @Inject(StaffRoleRequestsService)
    private readonly service: Pick<StaffRoleRequestsService, 'list' | 'decide'>,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  async list(
    @Req() request: SessionIdentity,
    @Query() query: StaffRoleRequestsQueryRequestDto,
  ): Promise<StaffRoleRequestListResponseDto> {
    const page = await this.service.list(
      request.sessionGithubId,
      query.toQuery(),
    );
    return StaffRoleRequestListResponseDto.from(page);
  }

  @Patch(':id')
  @UseGuards(SessionGuard, OriginGuard)
  async decide(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchStaffRoleRequestDto,
  ): Promise<StaffRoleRequestResponseDto> {
    const result = await this.service.decide(
      request.sessionGithubId,
      id,
      body.toAction(),
    );
    return StaffRoleRequestResponseDto.from(result);
  }
}
