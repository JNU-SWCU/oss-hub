import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RepositoryProvisionWorkerService } from './repository-provision-worker.service';
import { RepositoriesRepository } from './repositories.repository';
import {
  parseRepositoryAccessSyncEvent,
  REPOSITORY_PROVISION_EVENT_TYPE,
  parseRepositoryProvisionEvent,
} from './repository-provision-event.config';
import { InvalidRepositoryProvisionEventError } from './repositories.error';
import { REPOSITORY_ACCESS_SYNC_EVENT_TYPE } from '../platform/repository-access-sync.config';

const DEFAULT_OUTBOX_LEASE_MS = 5 * 60_000;
const PROVISION_POLL_INTERVAL_MS = 5_000;
const PROVISION_BATCH_SIZE = 10;

export type RepositoryOutboxConsumeResult =
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'CONSUMED';
      readonly eventId: string;
      readonly jobId: string;
    }
  | { readonly kind: 'FAILED'; readonly eventId: string };

@Injectable()
export class RepositoryOutboxConsumerService {
  private readonly logger = new Logger(RepositoryOutboxConsumerService.name);
  private readonly schedulerLogger = new Logger('RepositoryProvisionScheduler');
  private readonly workerId = `repository-${randomUUID()}`;
  private running = false;

  constructor(
    private readonly repository: RepositoriesRepository,
    @Inject(RepositoryProvisionWorkerService)
    private readonly worker: Pick<RepositoryProvisionWorkerService, 'runNext'>,
    @Optional()
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
      this.schedulerLogger.error({
        event: 'repositories.provision.poll.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.running = false;
    }
  }

  async runBatch(): Promise<void> {
    for (let index = 0; index < PROVISION_BATCH_SIZE; index += 1) {
      const result = await this.consumeNext(this.workerId, this.now());
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
