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
import { RoleRequestResponseDto } from './dto/role-request-response.dto';
import {
  RoleSelectionResponseDto,
  RoleSelectionStateResponseDto,
} from './dto/role-selection-response.dto';
import { SelectRoleRequestDto } from './dto/select-role-request.dto';
import { RolesService } from './roles.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(RolesService)
    private readonly rolesService: Pick<
      RolesService,
      'selectRole' | 'getMySelection'
    >,
  ) {}

  /**
   * 지금 고른 역할을 돌려준다. 역할 선택 화면이 다시 열릴 때 이전 선택을 되살리고,
   * 프로필 화면이 무엇을 물을지 정하는 데 쓴다(#569).
   *
   * `Cache-Control`을 `OriginGuard`처럼 붙이지 않는 이유는 이 값이 권한이 아니라
   * 진행 상태이기 때문이다 — 세션 응답(`auth/me`)과 달리 캐시돼도 권한이 새지 않는다.
   * 다만 사용자별 값이라 공유 캐시에 남으면 안 되므로 `private, no-store`를 건다.
   */
  @Get('role')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async getMySelection(
    @Req() request: SessionIdentity,
  ): Promise<RoleSelectionStateResponseDto> {
    return RoleSelectionStateResponseDto.from(
      await this.rolesService.getMySelection(request.sessionGithubId),
    );
  }

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
