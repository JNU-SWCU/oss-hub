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
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { requireValidUserId } from '../users/user-id.policy';
import { AdminAccessService } from '../users/admin-access.service';
import { AdminProfileService } from '../users/admin-profile.service';
import { AdminAccessListRequestDto } from './dto/admin-access-list-request.dto';
import { PatchAdminAccessRequestDto } from './dto/patch-admin-access-request.dto';
import { PatchAdminUserProfileRequestDto } from './dto/patch-admin-user-profile-request.dto';
import {
  AdminAccessFacetsResponseDto,
  AdminAccessMutationResponseDto,
  AdminAccessUserPageResponseDto,
  AdminProfileUpdateResponseDto,
  IndependentAuthorityMutationResponseDto,
} from './dto/admin-access-user-page-response.dto';
import { PatchIndependentAuthorityRequestDto } from './dto/patch-independent-authority-request.dto';
import { IndependentAuthorityService } from '../users/independent-authority.service';
import { PatchMemberKindRequestDto } from './dto/patch-member-kind-request.dto';
import { MemberKindService } from '../users/member-kind.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users')
export class UserAccessController {
  constructor(
    @Inject(AdminAccessService)
    private readonly service: Pick<
      AdminAccessService,
      'list' | 'facets' | 'patchAccess'
    >,
    @Inject(AdminProfileService)
    private readonly profileService: Pick<AdminProfileService, 'patchProfile'>,
    @Inject(IndependentAuthorityService)
    private readonly authorityService: Pick<
      IndependentAuthorityService,
      'patchAdminAccess'
    >,
    @Inject(MemberKindService)
    private readonly memberKindService: Pick<
      MemberKindService,
      'patchMemberKind'
    >,
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

  @Patch(':id/admin-access')
  @UseGuards(SessionGuard, OriginGuard)
  async patchAdminAccess(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchIndependentAuthorityRequestDto,
  ): Promise<IndependentAuthorityMutationResponseDto> {
    requireValidUserId(id);
    return IndependentAuthorityMutationResponseDto.from(
      await this.authorityService.patchAdminAccess(
        request.sessionGithubId,
        id,
        body.toCommand(),
      ),
    );
  }

  @Patch(':id/member-kind')
  @UseGuards(SessionGuard, OriginGuard)
  async patchMemberKind(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchMemberKindRequestDto,
  ): Promise<IndependentAuthorityMutationResponseDto> {
    requireValidUserId(id);
    return IndependentAuthorityMutationResponseDto.from(
      await this.memberKindService.patchMemberKind(
        request.sessionGithubId,
        id,
        body.toCommand(),
      ),
    );
  }
}
