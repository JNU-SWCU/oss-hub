import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileService } from './admin-profile.service';
import {
  AdminAccessHistoryRequestDto,
  AdminAccessListRequestDto,
} from './dto/admin-access-query.dto';
import { PatchAdminAccessRequestDto } from './dto/patch-admin-access.dto';
import { PatchAdminUserProfileRequestDto } from './dto/patch-admin-user-profile.dto';
import {
  AdminAccessFacetsResponseDto,
  AdminAccessMutationResponseDto,
  AdminAccessUserDetailResponseDto,
  AdminAccessUserHistoryResponseDto,
  AdminAccessUserPageResponseDto,
  AdminProfileUpdateResponseDto,
} from './dto/admin-access-response.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;
const USER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

@Controller('users')
export class AdminAccessController {
  constructor(
    @Inject(AdminAccessService)
    private readonly service: Pick<
      AdminAccessService,
      'list' | 'facets' | 'get' | 'getHistory' | 'patchAccess'
    >,
    @Inject(AdminProfileService)
    private readonly profileService: Pick<AdminProfileService, 'patchProfile'>,
  ) {}

  @Get('access')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async list(
    @Req() request: SessionIdentity,
    @Query() query: AdminAccessListRequestDto,
  ): Promise<AdminAccessUserPageResponseDto> {
    return AdminAccessUserPageResponseDto.from(
      await this.service.list(request.sessionGithubId, query.toQuery()),
    );
  }

  @Get('access/facets')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async facets(
    @Req() request: SessionIdentity,
    @Query() query: AdminAccessListRequestDto,
  ): Promise<AdminAccessFacetsResponseDto> {
    return AdminAccessFacetsResponseDto.from(
      await this.service.facets(request.sessionGithubId, query.toQuery()),
    );
  }

  @Get(':id/access')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async get(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<AdminAccessUserDetailResponseDto> {
    requireValidUserId(id);
    return AdminAccessUserDetailResponseDto.from(
      await this.service.get(request.sessionGithubId, id),
    );
  }

  @Get(':id/access/history')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async getHistory(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Query() query: AdminAccessHistoryRequestDto,
  ): Promise<AdminAccessUserHistoryResponseDto> {
    requireValidUserId(id);
    return AdminAccessUserHistoryResponseDto.from(
      await this.service.getHistory(
        request.sessionGithubId,
        id,
        query.toQuery(),
      ),
    );
  }

  @Patch(':id/access')
  @UseGuards(SessionGuard, OriginGuard)
  async patchAccess(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchAdminAccessRequestDto,
  ): Promise<AdminAccessMutationResponseDto> {
    requireValidUserId(id);
    return AdminAccessMutationResponseDto.from(
      await this.service.patchAccess(
        request.sessionGithubId,
        id,
        body.toCommand(),
      ),
    );
  }

  @Patch(':id/profile')
  @UseGuards(SessionGuard, OriginGuard)
  async patchProfile(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchAdminUserProfileRequestDto,
  ): Promise<AdminProfileUpdateResponseDto> {
    requireValidUserId(id);
    return AdminProfileUpdateResponseDto.from(
      await this.profileService.patchProfile(
        request.sessionGithubId,
        id,
        body.toCommand(),
      ),
    );
  }
}

function requireValidUserId(id: string): void {
  // 'me'는 세션 사용자를 가리키는 예약어라 관리자 대리 조회/수정의 유효한 대상 ID가
  // 아니다(#787) — 라우트 등록 순서가 흔들려도 이중 방어로 남긴다.
  if (id === 'me' || !USER_ID_PATTERN.test(id)) {
    throw new DomainException(
      ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ID],
    );
  }
}
