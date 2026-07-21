import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

import { CollectionConfig } from './collection.config';
import { CollectionService } from './collection.service';
import { COLLECTION_RUN_STATUSES } from './domain/collection-run';

export const COLLECTION_CRON_JOB_NAME = 'collection-batch';
export const DEFAULT_COLLECTION_CRON_EXPRESSION = '0 0 3 * * *';

const collectionCronExpression =
  process.env.COLLECTION_CRON_EXPRESSION?.trim() ||
  DEFAULT_COLLECTION_CRON_EXPRESSION;
const retryDelaysMs = [5 * 60_000, 15 * 60_000, 45 * 60_000] as const;

export interface CollectionExecution {
  readonly runId: string;
  readonly completion: Promise<void>;
}

class CollectionBatchFailedError extends Error {
  override readonly name = 'CollectionBatchFailedError';

  constructor() {
    super('Collection batch failed after three retries');
  }
}

@Injectable()
export class CollectionSchedulerService {
  private readonly logger = new Logger(CollectionSchedulerService.name);
  private activeExecution: CollectionExecution | null = null;

  constructor(
    private readonly collectionService: CollectionService,
    private readonly config: CollectionConfig,
  ) {}

  @Cron(collectionCronExpression, {
    name: COLLECTION_CRON_JOB_NAME,
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    const execution = this.trigger();
    await execution.completion.then(
      () => undefined,
      // trigger()가 최종 실패를 기록한다. cron 예외는 프로세스 밖으로 전파하지 않는다.
      () => undefined,
    );
  }

  trigger(): CollectionExecution {
    if (this.activeExecution) {
      return this.activeExecution;
    }

    const execution: CollectionExecution = {
      runId: randomUUID(),
      completion: this.runWithRetries(),
    };
    this.activeExecution = execution;

    const clearExecution = (): void => {
      if (this.activeExecution === execution) {
        this.activeExecution = null;
      }
    };
    void execution.completion.then(clearExecution, clearExecution);
    void execution.completion.catch((error: unknown) => {
      this.logger.error({
        event: 'collection.scheduler.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    });

    return execution;
  }

  private async runWithRetries(): Promise<void> {
    let pendingLogins = [...this.config.batchLogins];
    if (pendingLogins.length === 0) {
      return;
    }

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      try {
        const runs = await this.collectionService.runBatch(pendingLogins);
        const succeededLogins = new Set(
          runs
            .filter((run) => run.status === COLLECTION_RUN_STATUSES.SUCCEEDED)
            .map((run) => run.targetLogin),
        );
        pendingLogins = pendingLogins.filter(
          (login) => !succeededLogins.has(login),
        );
        if (pendingLogins.length === 0) {
          return;
        }
      } catch (error) {
        this.logger.warn({
          event: 'collection.scheduler.attempt_failed',
          attempt: attempt + 1,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }

      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined) {
        break;
      }
      this.logger.warn({
        event: 'collection.scheduler.retry_scheduled',
        attempt: attempt + 1,
        delayMs,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }

    throw new CollectionBatchFailedError();
  }
}
