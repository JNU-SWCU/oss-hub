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
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { StaffAccessRequestResponseDto } from './dto/role-request-response.dto';
import {
  RoleSelectionResponseDto,
  MemberKindSelectionStateResponseDto,
} from './dto/role-selection-response.dto';
import { SelectStaffAccessRequestDto } from './dto/select-role-request.dto';
import { RolesService } from './roles.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(RolesService)
    private readonly rolesService: Pick<
      RolesService,
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
    @Body() body: SelectStaffAccessRequestDto,
  ): Promise<RoleSelectionResponseDto> {
    const result = await this.rolesService.selectMemberKind(
      request.sessionGithubId,
      body.toMemberKind(),
    );
    return RoleSelectionResponseDto.from(result);
  }
}

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
  ): Promise<StaffAccessRequestResponseDto | null> {
    const staffAccessRequest = await this.rolesService.getMyRequest(
      request.sessionGithubId,
    );
    return staffAccessRequest
      ? StaffAccessRequestResponseDto.from(staffAccessRequest)
      : null;
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
