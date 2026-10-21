import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CollectionSweepRunner } from './collection-sweep-runner';

import { DomainException } from '../../common/error-code';
import { PROCESS_RUNTIME_CONFIG } from '../../runtime-config/runtime-config.instance';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../domain/collection-error-code.enum';
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
  private readonly sweeps: CollectionSweepRunner;

  constructor(
    private readonly sync: CollectionSyncService,
    private readonly cutover: CollectionCutoverRepository,
    userActivity: CollectionUserActivityService,
  ) {
    this.sweeps = new CollectionSweepRunner(
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
