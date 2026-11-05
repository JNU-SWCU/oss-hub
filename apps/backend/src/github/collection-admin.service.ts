import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CollectionSweepRunnerService } from './collection-sweep-runner.service';
import { DomainException } from '../platform/error-code.error';
import { CollectionCutoverRepository } from './repository-provision-job.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from './collection-error-code.error';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';

@Injectable()
export class CollectionAdminService {
  private readonly logger = new Logger('CollectionAdminController');
  private readonly ownerId = `admin:${randomUUID()}`;
  private readonly sweeps: CollectionSweepRunnerService;

  constructor(
    @Inject(CollectionSyncService)
    sync: Pick<CollectionSyncService, 'run' | 'runExternal'>,
    @Inject(CollectionCutoverRepository)
    private readonly cutover: Pick<CollectionCutoverRepository, 'isQuiesced'>,
    @Inject(CollectionUserActivityService)
    userActivity: Pick<CollectionUserActivityService, 'run'>,
  ) {
    this.sweeps = new CollectionSweepRunnerService(
      sync,
      userActivity,
      this.logger,
      'collection.admin',
    );
  }

  async trigger(): Promise<{ runId: string; status: 'PENDING' }> {
    if (await this.cutover.isQuiesced(new Date())) {
      throw new DomainException(
        COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
      );
    }
    const runId = randomUUID();
    this.sweeps.start(this.ownerId, runId);
    return { runId, status: 'PENDING' };
  }
}
