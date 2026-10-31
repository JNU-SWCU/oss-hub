import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import {
  AdminAccessService,
  requireValidUserId,
} from '../users/admin-access.service';
import {
  AccessRequestsHistoryRequestDto,
  AccessRequestsListRequestDto,
} from './dto/access-requests-list-request.dto';
import {
  AccessRequestsUserDetailResponseDto,
  AccessRequestsUserHistoryResponseDto,
  AccessRequestsUserPageResponseDto,
} from './dto/access-requests-user-page-response.dto';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users')
export class AccessRequestsController {
  constructor(
    @Inject(AdminAccessService)
    private readonly service: Pick<
      AdminAccessService,
      'listRequests' | 'get' | 'getHistory'
    >,
  ) {}

  @Get('access/requests')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async listRequests(
    @Req() request: SessionIdentity,
    @Query() query: AccessRequestsListRequestDto,
  ): Promise<AccessRequestsUserPageResponseDto> {
    return AccessRequestsUserPageResponseDto.from(
      await this.service.listRequests(
        request.sessionGithubId,
        query.toRequestQuery(),
      ),
    );
  }

  @Get(':id/access')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async get(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<AccessRequestsUserDetailResponseDto> {
    requireValidUserId(id);
    return AccessRequestsUserDetailResponseDto.from(
      await this.service.get(request.sessionGithubId, id),
    );
  }

  @Get(':id/access/history')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async getHistory(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Query() query: AccessRequestsHistoryRequestDto,
  ): Promise<AccessRequestsUserHistoryResponseDto> {
    requireValidUserId(id);
    return AccessRequestsUserHistoryResponseDto.from(
      await this.service.getHistory(
        request.sessionGithubId,
        id,
        query.toQuery(),
      ),
    );
  }
}
