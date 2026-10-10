import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  COLLECTION_TRIGGER_AUDIT_ACTIONS,
  createCollectionTriggerAuditMetadata,
} from '../../audit-log/domain/audit-log-metadata';
import { AuditLogService } from '../../audit-log/service/audit-log.service';
import { DomainException } from '../../common/error-code';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { ContributionInvariants } from '../repository/contribution-invariants';
import type { ContributionInvariantReport } from '../domain/contribution-invariants';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../domain/collection-error-code.enum';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import {
  CollectionSyncService,
  type CollectionSyncRunResult,
} from './collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from './collection-user-activity.service';
import { CollectionRunListResponseDto } from '../dto/collection-run-list-response.dto';
import { CollectionTriggerResponseDto } from '../dto/collection-trigger-response.dto';

const COLLECTION_RUN_LIST_LIMIT = 20;

@Injectable()
export class CollectionAdminService {
  private readonly logger = new Logger('CollectionAdminController');
  private readonly ownerId = `admin:${randomUUID()}`;

  constructor(
    private readonly sync: CollectionSyncService,
    private readonly cutover: CollectionCutoverRepository,
    private readonly incrementalRepository: CollectionIncrementalRepository,
    private readonly auditLog: AuditLogService,
    private readonly invariants: ContributionInvariants,
    private readonly userActivity: CollectionUserActivityService,
    private readonly authority: UsersAuthorityService,
  ) {}

  private async assertAdmin(sessionGithubId: bigint): Promise<void> {
    await this.authority.assertAdmin(
      sessionGithubId,
      () =>
        new DomainException(
          COLLECTION_ERROR_CODES[CollectionErrorCode.ADMIN_REQUIRED],
        ),
    );
  }

  async checkInvariants(
    sessionGithubId: bigint,
  ): Promise<ContributionInvariantReport> {
    await this.assertAdmin(sessionGithubId);
    return this.invariants.check();
  }

  async trigger(
    sessionGithubId: bigint,
  ): Promise<CollectionTriggerResponseDto> {
    await this.assertAdmin(sessionGithubId);
    if (await this.cutover.isQuiesced(new Date())) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
      );
    }
    const runId = randomUUID();
    await this.auditLog.record({
      actorGithubId: sessionGithubId,
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

  async listRuns(
    sessionGithubId: bigint,
  ): Promise<CollectionRunListResponseDto> {
    await this.assertAdmin(sessionGithubId);
    const runs = await this.incrementalRepository.listSyncRuns(
      new Date(),
      COLLECTION_RUN_LIST_LIMIT,
    );
    return CollectionRunListResponseDto.from(runs);
  }
}
