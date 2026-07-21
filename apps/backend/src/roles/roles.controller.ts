import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { RoleRequestResponseDto } from './dto/role-request-response.dto';
import { RoleSelectionResponseDto } from './dto/role-selection-response.dto';
import { SelectRoleRequestDto } from './dto/select-role-request.dto';
import { RolesService } from './roles.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(RolesService)
    private readonly rolesService: Pick<RolesService, 'selectRole'>,
  ) {}

  @Post('role')
  @UseGuards(SessionGuard, OriginGuard)
  async selectRole(
    @Req() request: SessionIdentity,
    @Body() body: SelectRoleRequestDto,
  ): Promise<RoleSelectionResponseDto> {
    const result = await this.rolesService.selectRole(
      request.sessionGithubId,
      body.toRole(),
    );
    return RoleSelectionResponseDto.from(result);
  }
}

@Controller('role-requests')
export class RoleRequestsController {
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
  ): Promise<RoleRequestResponseDto | null> {
    const roleRequest = await this.rolesService.getMyRequest(
      request.sessionGithubId,
    );
    return roleRequest ? RoleRequestResponseDto.from(roleRequest) : null;
  }

  @Post()
  @UseGuards(SessionGuard, OriginGuard)
  async retry(
    @Req() request: SessionIdentity,
  ): Promise<RoleRequestResponseDto> {
    const roleRequest = await this.rolesService.retryStaffRequest(
      request.sessionGithubId,
    );
    return RoleRequestResponseDto.from(roleRequest);
  }
}
