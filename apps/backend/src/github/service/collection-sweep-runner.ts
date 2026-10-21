import type { Logger } from '@nestjs/common';
import type {
  CollectionSyncService,
  CollectionSyncRunResult,
} from './collection-sync.service';
import type {
  CollectionUserActivityService,
  CollectionUserActivitySweepResult,
} from './collection-user-activity.service';

export class CollectionSweepRunner {
  constructor(
    private readonly sync: Pick<CollectionSyncService, 'run' | 'runExternal'>,
    private readonly userActivity: Pick<CollectionUserActivityService, 'run'>,
    private readonly logger: Pick<Logger, 'log' | 'error'>,
    private readonly eventPrefix: 'collection.admin' | 'collection.scheduler',
  ) {}

  start(ownerId: string, runId: string): void {
    const startedAt = Date.now();
    this.observeSweep('org', runId, startedAt, this.sync.run(ownerId, runId));
    this.observeSweep(
      'external',
      runId,
      startedAt,
      this.sync.runExternal(ownerId, runId),
    );
    this.observePersonSweep(runId, startedAt, this.userActivity.run());
  }

  observeRepository(
    runId: string,
    startedAt: number,
    sweep: Promise<CollectionSyncRunResult>,
  ): void {
    this.observeSweep('repository', runId, startedAt, sweep);
  }

  private observeSweep(
    scope: 'org' | 'external' | 'repository',
    runId: string,
    startedAt: number,
    sweep: Promise<CollectionSyncRunResult>,
  ): void {
    void sweep.then(
      (result) => {
        this.logger.log({
          event: `${this.eventPrefix}.completed`,
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
          event: `${this.eventPrefix}.${scope === 'org' ? 'sync_failed' : `${scope}_sync_failed`}`,
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
          event: `${this.eventPrefix}.completed`,
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
          event: `${this.eventPrefix}.person_sync_failed`,
          scope: 'person',
          runId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      },
    );
  }
}
