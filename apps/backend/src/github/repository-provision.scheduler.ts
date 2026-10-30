import { randomUUID } from 'node:crypto';
import { Logger } from '../../../../node_modules/.pnpm/@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0.14.4_reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/common';
import { Interval } from '../../../../node_modules/.pnpm/@nestjs+schedule@6.1.3_@nestjs+common@11.1.28_class-transformer@0.5.1_class-validator@0_e75f0cc371221d379e70a1a969cce4d1/node_modules/@nestjs/schedule';
import {
  PROVISION_BATCH_SIZE,
  PROVISION_POLL_INTERVAL_MS,
  RepositoryOutboxConsumerService,
} from './repository-outbox-consumer.service';
import type { RepositoryProvisionWorkerService } from './repository-provision-worker.service';

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
