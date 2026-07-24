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
import { DomainException } from '../common/error-code';
import { AdminUserQueryRequestDto } from './dto/admin-user-query.dto';
import { AdminUserResponseDto } from './dto/admin-user-response.dto';
import { PatchUserRoleRequestDto } from './dto/patch-user-role.dto';
import { AdminUsersService } from './admin-users.service';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.enum';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;
const USER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

@Controller('users')
export class AdminUsersController {
  constructor(
    @Inject(AdminUsersService)
    private readonly service: Pick<AdminUsersService, 'list' | 'updateRole'>,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  async list(
    @Req() request: SessionIdentity,
    @Query() query: AdminUserQueryRequestDto,
  ): Promise<readonly AdminUserResponseDto[]> {
    const users = await this.service.list(
      request.sessionGithubId,
      query.toQuery(),
    );
    return users.map((user) => AdminUserResponseDto.from(user));
  }

  @Patch(':id/role')
  @UseGuards(SessionGuard, OriginGuard)
  async updateRole(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: PatchUserRoleRequestDto,
  ): Promise<AdminUserResponseDto> {
    if (!USER_ID_PATTERN.test(id)) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ID],
      );
    }
    return AdminUserResponseDto.from(
      await this.service.updateRole(request.sessionGithubId, id, body.toRole()),
    );
  }
}
