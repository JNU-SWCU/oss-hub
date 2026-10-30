import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CollectionSweepRunner } from './collection-sweep-runner';
import {
  COLLECTION_SNAPSHOT_BACKFILL_AUDIT_ACTIONS,
  COLLECTION_TRIGGER_AUDIT_ACTIONS,
  createCollectionSnapshotBackfillAuditMetadata,
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
  CollectionSnapshotBackfillService,
  type CollectionSnapshotBackfillResult,
} from './collection-snapshot-backfill.service';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';
import type { CollectionSyncRunRow } from '../collection-incremental.types';

const COLLECTION_RUN_LIST_LIMIT = 20;

@Injectable()
export class CollectionAdminService {
  private readonly logger = new Logger('CollectionAdminController');
  private readonly ownerId = `admin:${randomUUID()}`;
  private readonly sweeps: CollectionSweepRunner;

  constructor(
    @Inject(CollectionSyncService)
    sync: Pick<CollectionSyncService, 'run' | 'runExternal'>,
    @Inject(CollectionCutoverRepository)
    private readonly cutover: Pick<CollectionCutoverRepository, 'isQuiesced'>,
    @Inject(CollectionIncrementalRepository)
    private readonly incrementalRepository: Pick<
      CollectionIncrementalRepository,
      'listSyncRuns'
    >,
    @Inject(AuditLogService)
    private readonly auditLog: Pick<AuditLogService, 'record'>,
    @Inject(ContributionInvariants)
    private readonly invariants: Pick<ContributionInvariants, 'check'>,
    @Inject(CollectionUserActivityService)
    userActivity: Pick<CollectionUserActivityService, 'run'>,
    private readonly authority: UsersAuthorityService,
    @Inject(CollectionSnapshotBackfillService)
    private readonly snapshotBackfill: Pick<
      CollectionSnapshotBackfillService,
      'run' | 'assertSupportedYear' | 'assertReady'
    >,
  ) {
    this.sweeps = new CollectionSweepRunner(
      sync,
      userActivity,
      this.logger,
      'collection.admin',
    );
  }

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
  ): Promise<{ runId: string; status: 'PENDING' }> {
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
    this.sweeps.start(this.ownerId, runId);
    return { runId, status: 'PENDING' };
  }

  async backfillSnapshots(
    sessionGithubId: bigint,
    year: number,
  ): Promise<{ accepted: true; year: number }> {
    await this.assertAdmin(sessionGithubId);
    if (await this.cutover.isQuiesced(new Date())) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
      );
    }
    this.snapshotBackfill.assertSupportedYear(year);
    await this.snapshotBackfill.assertReady(year);
    await this.auditLog.record({
      actorGithubId: sessionGithubId,
      action:
        COLLECTION_SNAPSHOT_BACKFILL_AUDIT_ACTIONS.COLLECTION_SNAPSHOT_BACKFILL_TRIGGERED,
      targetType: 'COLLECTION_SNAPSHOT_BACKFILL',
      targetId: year.toString(),
      metadata: createCollectionSnapshotBackfillAuditMetadata({ year }),
    });
    this.observeSnapshotBackfill(year, this.snapshotBackfill.run(year));
    return { accepted: true, year };
  }

  private observeSnapshotBackfill(
    year: number,
    backfill: Promise<CollectionSnapshotBackfillResult>,
  ): void {
    const startedAt = Date.now();
    void backfill.then(
      (result) => {
        this.logger.log({
          event: 'collection.snapshot_backfill.completed',
          year,
          durationMs: Date.now() - startedAt,
          observedUserCount: result.observedUserCount,
          requestCount: result.requestCount,
          writtenRowCount: result.writtenRowCount,
          skippedExistingCount: result.skippedExistingCount,
          skippedStaleCount: result.skippedStaleCount,
          failedUserCount: result.failedUserCount,
          stoppedForBudget: result.stoppedForBudget,
        });
      },
      (error: unknown) => {
        this.logger.error({
          event: 'collection.snapshot_backfill.failed',
          year,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      },
    );
  }

  async listRuns(
    sessionGithubId: bigint,
  ): Promise<readonly CollectionSyncRunRow[]> {
    await this.assertAdmin(sessionGithubId);
    return this.incrementalRepository.listSyncRuns(
      new Date(),
      COLLECTION_RUN_LIST_LIMIT,
    );
  }
}
