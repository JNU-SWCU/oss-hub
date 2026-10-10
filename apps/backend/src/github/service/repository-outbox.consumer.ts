import { Injectable, Logger } from '@nestjs/common';
import {
  InvalidRepositoryProvisionEventError,
  parseRepositoryAccessSyncEvent,
  parseRepositoryProvisionEvent,
  REPOSITORY_ACCESS_SYNC_EVENT_TYPE,
  REPOSITORY_PROVISION_EVENT_TYPE,
} from '../domain/repository-provision-event';
import { RepositoriesRepository } from '../repository/repositories.repository';

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
        if (event.type === REPOSITORY_PROVISION_EVENT_TYPE) {
          const payload = parseRepositoryProvisionEvent(event.payload);
          if (payload.applicationId !== event.aggregateId) {
            throw new InvalidRepositoryProvisionEventError();
          }
          const job = await store.findProvisionJob(payload.applicationId);
          if (job === null) {
            throw new InvalidRepositoryProvisionEventError();
          }
          if (job.currentEventId !== event.id) {
            await store.confirmSupersededProvisionEvent(
              event.id,
              payload.applicationId,
              now,
            );
          }

          await store.completeProvisionEvent(event.id, workerId, now);
          return { kind: 'CONSUMED', eventId: event.id, jobId: job.id };
        }

        const payload = parseEventPayload(event.type, event.payload);
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

function parseEventPayload(
  type: string,
  payload: unknown,
): { readonly applicationId: string } {
  if (type === REPOSITORY_ACCESS_SYNC_EVENT_TYPE) {
    return parseRepositoryAccessSyncEvent(payload);
  }
  throw new InvalidRepositoryProvisionEventError();
}
