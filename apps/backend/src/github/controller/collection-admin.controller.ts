import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { OriginGuard } from '../../auth/origin.guard';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../../auth/session.guard';
import {
  COLLECTION_TRIGGER_AUDIT_ACTIONS,
  createCollectionTriggerAuditMetadata,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import { ContributionInvariants } from '../contribution-invariants';
import type { ContributionInvariantReport } from '../contribution-invariants';
import { CollectionAdminGuard } from '../collection-admin.guard';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../collection-error-code.enum';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import {
  CollectionSyncService,
  type CollectionSyncRunResult,
} from '../service/collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from '../service/collection-user-activity.service';
import { CollectionRunListResponseDto } from '../dto/collection-run-list-response.dto';
import { CollectionTriggerResponseDto } from '../dto/collection-trigger-response.dto';

export const COLLECTION_RUN_LIST_LIMIT = 20;

@Controller('admin/collection')
export class CollectionAdminController {
  private readonly logger = new Logger(CollectionAdminController.name);
  private readonly ownerId = `admin:${randomUUID()}`;

  constructor(
    private readonly sync: CollectionSyncService,
    private readonly cutover: CollectionCutoverRepository,
    private readonly incrementalRepository: CollectionIncrementalRepository,
    private readonly auditLog: AuditLogService,
    private readonly invariants: ContributionInvariants,
    private readonly userActivity: CollectionUserActivityService,
  ) {}

  @Get('invariants')
  @UseGuards(SessionGuard, CollectionAdminGuard)
  async checkInvariants(): Promise<ContributionInvariantReport> {
    return this.invariants.check();
  }

  @Post('trigger')
  @HttpCode(202)
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  async trigger(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
  ): Promise<CollectionTriggerResponseDto> {
    if (await this.cutover.isQuiesced(new Date())) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
      );
    }

    const runId = randomUUID();

    await this.auditLog.record({
      actorGithubId: request.sessionGithubId,
      action: COLLECTION_TRIGGER_AUDIT_ACTIONS.COLLECTION_SYNC_TRIGGERED,
      targetType: 'COLLECTION_SYNC',
      targetId: runId,
      metadata: createCollectionTriggerAuditMetadata({ runId }),
    });
    const startedAt = Date.now();
    this.observeSweep(
      'org',
      runId,
      startedAt,
      this.sync.run(this.ownerId, runId),
    );

    this.observeSweep(
      'external',
      runId,
      startedAt,
      this.sync.runExternal(this.ownerId, runId),
    );

    this.observePersonSweep(runId, startedAt, this.userActivity.run());
    return new CollectionTriggerResponseDto(runId);
  }

  private observeSweep(
    scope: 'org' | 'external',
    runId: string,
    startedAt: number,
    sweep: Promise<CollectionSyncRunResult>,
  ): void {
    void sweep.then(
      (result) => {
        this.logger.log({
          event: 'collection.admin.completed',
          scope,
          runId,
          syncStatus: result.status,
          durationMs: Date.now() - startedAt,
          repositoryCount: result.processedRepositoryCount,
          insertedFactCount: result.insertedFactCount,
          inventoryComplete: result.inventoryComplete,
          cycleCompleted: result.cycleCompleted,
          stoppedForBudget: result.stoppedForBudget,
        });
      },
      (error: unknown) => {
        this.logger.error({
          event:
            scope === 'org'
              ? 'collection.admin.sync_failed'
              : 'collection.admin.external_sync_failed',
          scope,
          runId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      },
    );
  }

  private observePersonSweep(
    runId: string,
    startedAt: number,
    sweep: Promise<CollectionUserActivitySweepResult>,
  ): void {
    void sweep.then(
      (result) => {
        this.logger.log({
          event: 'collection.admin.completed',
          scope: 'person',
          runId,
          durationMs: Date.now() - startedAt,
          observedUserCount: result.observedUserCount,
          upsertedRowCount: result.upsertedRowCount,
          skippedPastYearCount: result.skippedPastYearCount,
          failedUserCount: result.failedUserCount,
        });
      },
      (error: unknown) => {
        this.logger.error({
          event: 'collection.admin.person_sync_failed',
          scope: 'person',
          runId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      },
    );
  }

  @Get('runs')
  @UseGuards(SessionGuard, CollectionAdminGuard, OriginGuard)
  async listRuns(): Promise<CollectionRunListResponseDto> {
    const runs = await this.incrementalRepository.listSyncRuns(
      new Date(),
      COLLECTION_RUN_LIST_LIMIT,
    );
    return CollectionRunListResponseDto.from(runs);
  }
}
