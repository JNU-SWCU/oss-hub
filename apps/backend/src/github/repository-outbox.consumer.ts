import { Injectable, Logger } from '@nestjs/common';
import {
  InvalidRepositoryProvisionEventError,
  parseRepositoryProvisionEvent,
} from './repository-provision-event';
import { RepositoriesRepository } from './repositories.repository';

export const DEFAULT_OUTBOX_LEASE_MS = 5 * 60_000;

export type RepositoryOutboxConsumeResult =
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'CONSUMED';
      readonly eventId: string;
      readonly jobId: string;
    }
  | { readonly kind: 'FAILED'; readonly eventId: string };

@Injectable()
export class RepositoryOutboxConsumer {
  private readonly logger = new Logger(RepositoryOutboxConsumer.name);

  constructor(private readonly repository: RepositoriesRepository) {}

  async consumeNext(
    workerId: string,
    now = new Date(),
  ): Promise<RepositoryOutboxConsumeResult> {
    return this.repository.withTransaction(async (store) => {
      const event = await store.claimProvisionEvent({
        workerId,
        now,
        leaseMs: DEFAULT_OUTBOX_LEASE_MS,
      });
      if (event === null) {
        return { kind: 'EMPTY' };
      }

      try {
        const payload = parseRepositoryProvisionEvent(event.payload);
        if (payload.applicationId !== event.aggregateId) {
          throw new InvalidRepositoryProvisionEventError();
        }
        const job = await store.upsertProvisionJob(payload.applicationId, now);
        await store.completeProvisionEvent(event.id, workerId, now);
        return { kind: 'CONSUMED', eventId: event.id, jobId: job.id };
      } catch (error) {
        if (!(error instanceof InvalidRepositoryProvisionEventError)) {
          throw error;
        }
        await store.failProvisionEvent(event.id, workerId);
        this.logger.warn({
          event: 'repositories.outbox.failed',
          eventId: event.id,
          errorCode: 'INVALID_REPOSITORY_PROVISION_EVENT',
        });
        return { kind: 'FAILED', eventId: event.id };
      }
    });
  }
}
