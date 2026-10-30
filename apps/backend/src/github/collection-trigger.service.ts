import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CollectionSweepRunnerService } from './collection-sweep-runner.service';
import { DomainException } from '../platform/error-code.error';
import { PROCESS_RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { CollectionCutoverRepository } from './repository-provision-job.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from './collection-error-code.error';
import { CollectionSyncService } from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';
export const COLLECTION_CRON_JOB_NAME = 'collection-reconciliation';
export const DEFAULT_COLLECTION_CRON_EXPRESSION = '0 0 * * * *';

export const COLLECTION_CRON_EXPRESSION =
  PROCESS_RUNTIME_CONFIG.COLLECTION_CRON_EXPRESSION?.trim() ||
  DEFAULT_COLLECTION_CRON_EXPRESSION;

@Injectable()
export class CollectionTriggerService {
  private readonly logger = new Logger('CollectionSchedulerService');
  private readonly ownerId = `scheduler:${randomUUID()}`;
  private readonly sweeps: CollectionSweepRunnerService;

  constructor(
    private readonly sync: CollectionSyncService,
    private readonly cutover: CollectionCutoverRepository,
    userActivity: CollectionUserActivityService,
  ) {
    this.sweeps = new CollectionSweepRunnerService(
      sync,
      userActivity,
      this.logger,
      'collection.scheduler',
    );
  }

  async runScheduled(): Promise<void> {
    try {
      await this.trigger();
    } catch (error) {
      this.logger.error({
        event: 'collection.scheduler.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
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

  collectRepository(githubRepositoryId: bigint): void {
    const runId = randomUUID();
    const startedAt = Date.now();
    this.sweeps.observeRepository(
      runId,
      startedAt,
      this.cutover.isQuiesced(new Date()).then((quiesced) => {
        if (quiesced) {
          throw new DomainException(
            COLLECTION_ERROR_CODES[CollectionErrorCode.COLLECTION_QUIESCED],
          );
        }
        return this.sync.runRepository(this.ownerId, githubRepositoryId, runId);
      }),
    );
  }
}
