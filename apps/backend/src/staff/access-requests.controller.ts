import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { AdminAccessService } from '../users/admin-access.service';
import {
  AccessRequestsHistoryRequestDto,
  AccessRequestsListRequestDto,
} from './dto/access-requests-list-request.dto';
import {
  AccessRequestsUserDetailResponseDto,
  AccessRequestsUserHistoryResponseDto,
  AccessRequestsUserPageResponseDto,
} from './dto/access-requests-user-page-response.dto';
import { Protected } from '../auth/auth-route.decorator';

type SessionIdentity = Pick<
  AuthenticatedRequest,
  'sessionGithubId' | 'principal'
>;

@Controller('users')
export class AccessRequestsController {
  constructor(
    @Inject(AdminAccessService)
    private readonly service: Pick<
      AdminAccessService,
      'listRequests' | 'getFromRequest' | 'getHistoryFromRequest'
    >,
  ) {}

  @Get('access/requests')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async listRequests(
    @Req() request: SessionIdentity,
    @Query() query: AccessRequestsListRequestDto,
  ): Promise<AccessRequestsUserPageResponseDto> {
    return AccessRequestsUserPageResponseDto.from(
      await this.service.listRequests(request.principal, query),
    );
  }

  @Get(':id/access')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async get(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<AccessRequestsUserDetailResponseDto> {
    return AccessRequestsUserDetailResponseDto.from(
      await this.service.getFromRequest(request.principal, id),
    );
  }

  @Get(':id/access/history')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async getHistory(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Query() query: AccessRequestsHistoryRequestDto,
  ): Promise<AccessRequestsUserHistoryResponseDto> {
    return AccessRequestsUserHistoryResponseDto.from(
      await this.service.getHistoryFromRequest(request.principal, id, query),
    );
  }
}
