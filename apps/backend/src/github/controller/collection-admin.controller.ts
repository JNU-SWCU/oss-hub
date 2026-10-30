import {
  Body,
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
import { CollectionSnapshotBackfillRequestDto } from '../dto/collection-snapshot-backfill-request.dto';
import { CollectionSnapshotBackfillResponseDto } from '../dto/collection-snapshot-backfill-response.dto';
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
    const result = await this.admin.trigger(request.sessionGithubId);
    return new CollectionTriggerResponseDto(result.runId);
  }

  @Post('snapshot-backfill')
  @HttpCode(202)
  @UseGuards(SessionGuard, OriginGuard)
  async backfillSnapshots(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Body() body: CollectionSnapshotBackfillRequestDto,
  ): Promise<CollectionSnapshotBackfillResponseDto> {
    const result = await this.admin.backfillSnapshots(
      request.sessionGithubId,
      body.year,
    );
    return new CollectionSnapshotBackfillResponseDto(result.year);
  }

  @Get('runs')
  @UseGuards(SessionGuard, OriginGuard)
  async listRuns(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionRunListResponseDto> {
    return CollectionRunListResponseDto.from(
      await this.admin.listRuns(request.sessionGithubId),
    );
  }
}
