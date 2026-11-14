import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CollectionSweepRunnerService } from './collection-sweep-runner.service';
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

  trigger(
    fullScan: boolean | undefined,
  ): Promise<{ runId: string; status: 'PENDING' }> {
    const runId = randomUUID();
    this.sweeps.start(
      this.ownerId,
      runId,
      fullScan === true ? 'full' : 'hourly',
    );
    return Promise.resolve({ runId, status: 'PENDING' });
  }
}
