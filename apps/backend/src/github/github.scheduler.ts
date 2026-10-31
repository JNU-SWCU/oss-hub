import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import {
  COLLECTION_CRON_EXPRESSION,
  COLLECTION_CRON_JOB_NAME,
  CollectionTriggerService,
} from './collection-trigger.service';
import {
  PROVISION_BATCH_SIZE,
  PROVISION_POLL_INTERVAL_MS,
  RepositoryOutboxConsumerService,
} from './repository-outbox-consumer.service';
import type { RepositoryProvisionWorkerService } from './repository-provision-worker.service';

@Injectable()
export class GithubScheduler {
  constructor(
    @Inject(CollectionTriggerService)
    private readonly trigger: Pick<CollectionTriggerService, 'runScheduled'>,
  ) {}

  @Cron(COLLECTION_CRON_EXPRESSION, {
    name: COLLECTION_CRON_JOB_NAME,
    timeZone: 'Asia/Seoul',
    waitForCompletion: true,
  })
  handleCron(): Promise<void> {
    return this.trigger.runScheduled();
  }
}

export class RepositoryProvisionScheduler {
  private readonly logger = new Logger(RepositoryProvisionScheduler.name);
  private readonly workerId = `repository-${randomUUID()}`;
  private running = false;

  constructor(
    private readonly outbox: Pick<
      RepositoryOutboxConsumerService,
      'consumeNext'
    >,
    private readonly worker: Pick<RepositoryProvisionWorkerService, 'runNext'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  @Interval('repository-provision', PROVISION_POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.runBatch();
    } catch (error) {
      this.logger.error({
        event: 'repositories.provision.poll.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.running = false;
    }
  }

  async runBatch(): Promise<void> {
    for (let index = 0; index < PROVISION_BATCH_SIZE; index += 1) {
      const result = await this.outbox.consumeNext(this.workerId, this.now());
      if (result.kind === 'EMPTY') {
        break;
      }
    }
    for (let index = 0; index < PROVISION_BATCH_SIZE; index += 1) {
      const result = await this.worker.runNext(this.workerId);
      if (result.kind === 'EMPTY') {
        break;
      }
    }
  }
}
