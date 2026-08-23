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

  /**
   * 지금 고른 회원 유형을 돌려준다. 선택 화면이 다시 열릴 때 이전 선택을 되살리고,
   * 프로필 화면이 무엇을 물을지 정하는 데 쓴다(#569).
   *
   * `Cache-Control`을 `OriginGuard`처럼 붙이지 않는 이유는 이 값이 권한이 아니라
   * 진행 상태이기 때문이다 — 세션 응답과 달리 캐시돼도 권한이 새지 않는다.
   * 다만 사용자별 값이라 공유 캐시에 남으면 안 되므로 `private, no-store`를 건다.
   */
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
