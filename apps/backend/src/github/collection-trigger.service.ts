import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { CollectionSweepRunnerService } from './collection-sweep-runner.service';
import {
  CollectionSyncService,
  type CollectionRunKind,
} from './collection-sync.service';
import { CollectionUserActivityService } from './collection-user-activity.service';
export const COLLECTION_CRON_JOB_NAME = 'collection-reconciliation';
export const COLLECTION_CRON_EXPRESSION = '0 0 * * * *';
export const COLLECTION_WEEKLY_CRON_JOB_NAME = 'collection-weekly-full-scan';
export const COLLECTION_WEEKLY_CRON_EXPRESSION = '0 0 3 * * 0';

const isWeeklyFullScanHour = (at: Date): boolean => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  return (
    parts.find((part) => part.type === 'weekday')?.value === 'Sun' &&
    parts.find((part) => part.type === 'hour')?.value === '03'
  );
};

@Injectable()
export class CollectionTriggerService {
  private readonly logger = new Logger('CollectionSchedulerService');
  private readonly ownerId = `scheduler:${randomUUID()}`;
  private readonly sweeps: CollectionSweepRunnerService;

  constructor(
    private readonly sync: CollectionSyncService,
    userActivity: CollectionUserActivityService,
  ) {
    this.sweeps = new CollectionSweepRunnerService(
      sync,
      userActivity,
      this.logger,
      'collection.scheduler',
    );
  }

  @Cron(COLLECTION_CRON_EXPRESSION, {
    name: COLLECTION_CRON_JOB_NAME,
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  handleCron(): Promise<void> {
    if (isWeeklyFullScanHour(new Date())) return Promise.resolve();
    return this.runScheduled('hourly');
  }

  @Cron(COLLECTION_WEEKLY_CRON_EXPRESSION, {
    name: COLLECTION_WEEKLY_CRON_JOB_NAME,
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  handleWeeklyCron(): Promise<void> {
    return this.runScheduled('weekly');
  }

  async runScheduled(kind: CollectionRunKind): Promise<void> {
    try {
      await this.trigger(kind);
    } catch (error) {
      this.logger.error({
        event: 'collection.scheduler.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  trigger(
    kind: CollectionRunKind,
  ): Promise<{ runId: string; status: 'PENDING' }> {
    const runId = randomUUID();
    this.sweeps.start(this.ownerId, runId, kind);
    return Promise.resolve({ runId, status: 'PENDING' });
  }

  collectRepository(githubRepositoryId: bigint): void {
    const runId = randomUUID();
    const startedAt = Date.now();
    this.sweeps.observeRepository(
      runId,
      startedAt,
      this.sync.runRepository(this.ownerId, githubRepositoryId, runId),
    );
  }
}
