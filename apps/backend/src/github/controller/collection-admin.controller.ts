import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import type { ContributionInvariantReport } from '../domain/contribution-invariants';
import { CollectionRunListResponseDto } from '../dto/collection-run-list-response.dto';
import { CollectionTriggerResponseDto } from '../dto/collection-trigger-response.dto';
import { CollectionAdminService } from '../service/collection-admin.service';

@Controller('admin/collection')
export class CollectionAdminController {
  constructor(private readonly admin: CollectionAdminService) {}

  @Get('invariants')
  @UseGuards(SessionGuard)
  async checkInvariants(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<ContributionInvariantReport> {
    return this.admin.checkInvariants(request.sessionGithubId);
  }

  @Post('trigger')
  @HttpCode(202)
  @UseGuards(SessionGuard, OriginGuard)
  async trigger(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionTriggerResponseDto> {
    return this.admin.trigger(request.sessionGithubId);
  }

  @Get('runs')
  @UseGuards(SessionGuard, OriginGuard)
  async listRuns(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionRunListResponseDto> {
    return this.admin.listRuns(request.sessionGithubId);
  }
}
