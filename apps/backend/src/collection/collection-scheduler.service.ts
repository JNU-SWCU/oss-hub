import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

import { PROCESS_RUNTIME_CONFIG } from '../runtime-config/runtime-config.instance';
import { CollectionReconciliationService } from './collection-reconciliation.service';

export const COLLECTION_CRON_JOB_NAME = 'collection-reconciliation';
export const DEFAULT_COLLECTION_CRON_EXPRESSION = '0 0 * * * *';

/**
 * Nest `@Cron` evaluates its expression argument when the class is declared,
 * before DI can inject RUNTIME_CONFIG. 전역 provider와 같은 process snapshot을
 * 사용하되 credential 검증은 기존 reconciliation factory에서 지연한다.
 */
const collectionCronExpression =
  PROCESS_RUNTIME_CONFIG.COLLECTION_CRON_EXPRESSION?.trim() ||
  DEFAULT_COLLECTION_CRON_EXPRESSION;

@Injectable()
export class CollectionSchedulerService {
  private readonly logger = new Logger(CollectionSchedulerService.name);
  private readonly ownerId = `scheduler:${randomUUID()}`;

  constructor(
    private readonly reconciliation: CollectionReconciliationService,
  ) {}

  @Cron(collectionCronExpression, {
    name: COLLECTION_CRON_JOB_NAME,
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    try {
      await this.trigger();
    } catch (error) {
      this.logger.error({
        event: 'collection.scheduler.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  trigger(): Promise<{ runId: string; status: 'PENDING' }> {
    return this.reconciliation.trigger(this.ownerId);
  }
}
