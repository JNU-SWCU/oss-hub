import { Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { RepositoryOutboxConsumer } from './repository-outbox.consumer';
import type { RepositoryProvisionWorker } from './repository-provision.worker';

const PROVISION_POLL_INTERVAL_MS = 5_000;
const PROVISION_BATCH_SIZE = 10;

export class RepositoryProvisionScheduler {
  private readonly logger = new Logger(RepositoryProvisionScheduler.name);
  private readonly workerId = `repository-${randomUUID()}`;
  private running = false;

  constructor(
    private readonly outbox: Pick<RepositoryOutboxConsumer, 'consumeNext'>,
    private readonly worker: Pick<RepositoryProvisionWorker, 'runNext'>,
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

  async runBatch(now = new Date()): Promise<void> {
    for (let index = 0; index < PROVISION_BATCH_SIZE; index += 1) {
      const result = await this.outbox.consumeNext(this.workerId, now);
      if (result.kind === 'EMPTY') {
        break;
      }
    }
    for (let index = 0; index < PROVISION_BATCH_SIZE; index += 1) {
      const result = await this.worker.runNext(this.workerId, now);
      if (result.kind === 'EMPTY') {
        break;
      }
    }
  }
}
