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
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { requireValidUserId } from '../domain/user-id';
import { AdminAccessService } from '../service/admin-access.service';
import { AdminProfileService } from '../service/admin-profile.service';
import {
  AdminAccessHistoryRequestDto,
  AdminAccessListRequestDto,
} from '../dto/admin-access-query.dto';
import { PatchAdminAccessRequestDto } from '../dto/patch-admin-access.dto';
import { PatchAdminUserProfileRequestDto } from '../dto/patch-admin-user-profile.dto';
import {
  AdminAccessFacetsResponseDto,
  AdminAccessMutationResponseDto,
  AdminAccessUserDetailResponseDto,
  AdminAccessUserHistoryResponseDto,
  AdminAccessUserPageResponseDto,
  AdminProfileUpdateResponseDto,
} from '../dto/admin-access-response.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users')
export class AdminAccessController {
  constructor(
    @Inject(AdminAccessService)
    private readonly service: Pick<
      AdminAccessService,
      'list' | 'listRequests' | 'facets' | 'get' | 'getHistory' | 'patchAccess'
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

  @Get('access/requests')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async listRequests(
    @Req() request: SessionIdentity,
    @Query() query: AdminAccessListRequestDto,
  ): Promise<AdminAccessUserPageResponseDto> {
    return AdminAccessUserPageResponseDto.from(
      await this.service.listRequests(
        request.sessionGithubId,
        query.toRequestQuery(),
      ),
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
