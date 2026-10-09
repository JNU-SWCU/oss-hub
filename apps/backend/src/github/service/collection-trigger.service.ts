import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { DomainException } from '../../common/error-code';
import { PROCESS_RUNTIME_CONFIG } from '../../runtime-config/runtime-config.instance';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import {
  COLLECTION_ERROR_CODES,
  CollectionErrorCode,
} from '../collection-error-code.enum';
import {
  CollectionSyncService,
  type CollectionSyncRunResult,
} from './collection-sync.service';
import {
  CollectionUserActivityService,
  type CollectionUserActivitySweepResult,
} from './collection-user-activity.service';

export const COLLECTION_CRON_JOB_NAME = 'collection-reconciliation';
export const DEFAULT_COLLECTION_CRON_EXPRESSION = '0 0 * * * *';

export const COLLECTION_CRON_EXPRESSION =
  PROCESS_RUNTIME_CONFIG.COLLECTION_CRON_EXPRESSION?.trim() ||
  DEFAULT_COLLECTION_CRON_EXPRESSION;

const SYNC_FAILED_EVENTS = {
  org: 'collection.scheduler.sync_failed',
  external: 'collection.scheduler.external_sync_failed',
  repository: 'collection.scheduler.repository_sync_failed',
} as const;

@Injectable()
export class CollectionTriggerService {
  private readonly logger = new Logger('CollectionSchedulerService');
  private readonly ownerId = `scheduler:${randomUUID()}`;

  constructor(
    private readonly sync: CollectionSyncService,
    private readonly cutover: CollectionCutoverRepository,
    private readonly userActivity: CollectionUserActivityService,
  ) {}

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
    return { runId, status: 'PENDING' };
  }

  collectRepository(githubRepositoryId: bigint): void {
    const runId = randomUUID();
    const startedAt = Date.now();
    this.observeSweep(
      'repository',
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

  private observeSweep(
    scope: keyof typeof SYNC_FAILED_EVENTS,
    runId: string,
    startedAt: number,
    sweep: Promise<CollectionSyncRunResult>,
  ): void {
    void sweep.then(
      (result) => {
        this.logger.log({
          event: 'collection.scheduler.completed',
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
          event: SYNC_FAILED_EVENTS[scope],
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
          event: 'collection.scheduler.completed',
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
          event: 'collection.scheduler.person_sync_failed',
          scope: 'person',
          runId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      },
    );
  }
}
