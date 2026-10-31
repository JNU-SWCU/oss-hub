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
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
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
import { Protected } from '../auth/auth-route.decorator';

type SessionIdentity = Pick<
  AuthenticatedRequest,
  'sessionGithubId' | 'principal'
>;

@Controller('users')
export class UserAccessController {
  constructor(
    @Inject(AdminAccessService)
    private readonly service: Pick<
      AdminAccessService,
      'list' | 'facets' | 'patchAccessFromRequest'
    >,
    @Inject(AdminProfileService)
    private readonly profileService: Pick<
      AdminProfileService,
      'patchProfileFromRequest'
    >,
    @Inject(IndependentAuthorityService)
    private readonly authorityService: Pick<
      IndependentAuthorityService,
      'patchAdminAccessFromRequest'
    >,
    @Inject(MemberKindService)
    private readonly memberKindService: Pick<
      MemberKindService,
      'patchMemberKindFromRequest'
    >,
  ) {}

  @Get('access')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async list(
    @Req() request: SessionIdentity,
    @Query() query: AdminAccessListRequestDto,
  ): Promise<AdminAccessUserPageResponseDto> {
    return AdminAccessUserPageResponseDto.from(
      await this.service.list(request.principal, query),
    );
  }

  @Get('access/facets')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async facets(
    @Req() request: SessionIdentity,
    @Query() query: AdminAccessListRequestDto,
  ): Promise<AdminAccessFacetsResponseDto> {
    return AdminAccessFacetsResponseDto.from(
      await this.service.facets(request.principal, query),
    );
  }

  @Patch(':id/access')
  @Protected()
  @UseGuards(OriginGuard)
  async patchAccess(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchAdminAccessRequestDto,
  ): Promise<AdminAccessMutationResponseDto> {
    return AdminAccessMutationResponseDto.from(
      await this.service.patchAccessFromRequest(
        request.sessionGithubId,
        id,
        body,
      ),
    );
  }

  @Patch(':id/profile')
  @Protected()
  @UseGuards(OriginGuard)
  async patchProfile(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchAdminUserProfileRequestDto,
  ): Promise<AdminProfileUpdateResponseDto> {
    return AdminProfileUpdateResponseDto.from(
      await this.profileService.patchProfileFromRequest(
        request.sessionGithubId,
        id,
        body,
      ),
    );
  }

  @Patch(':id/admin-access')
  @Protected()
  @UseGuards(OriginGuard)
  async patchAdminAccess(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchIndependentAuthorityRequestDto,
  ): Promise<IndependentAuthorityMutationResponseDto> {
    return IndependentAuthorityMutationResponseDto.from(
      await this.authorityService.patchAdminAccessFromRequest(
        request.sessionGithubId,
        id,
        body,
      ),
    );
  }

  @Patch(':id/member-kind')
  @Protected()
  @UseGuards(OriginGuard)
  async patchMemberKind(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchMemberKindRequestDto,
  ): Promise<IndependentAuthorityMutationResponseDto> {
    return IndependentAuthorityMutationResponseDto.from(
      await this.memberKindService.patchMemberKindFromRequest(
        request.sessionGithubId,
        id,
        body,
      ),
    );
  }
}
