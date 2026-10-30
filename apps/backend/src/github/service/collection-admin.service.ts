import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CollectionSweepRunner } from './collection-sweep-runner';
import {
  COLLECTION_TRIGGER_AUDIT_ACTIONS,
  createCollectionTriggerAuditMetadata,
} from '../../platform/audit-log-metadata.policy';
import { AuditLogService } from '../../platform/audit-log.service';
import { DomainException } from '../../platform/error-code.error';
import { UsersAuthorityService } from '../../users/authority.service';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../domain/collection-error-code.enum';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';

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
    @Inject(AuditLogService)
    private readonly auditLog: Pick<AuditLogService, 'record'>,
    @Inject(CollectionUserActivityService)
    userActivity: Pick<CollectionUserActivityService, 'run'>,
    private readonly authority: UsersAuthorityService,
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
}
