import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SequentialRepository } from '../platform/sequential.repository';
import { ProgramMailBatchRepository } from './program-mail-batch.repository';
import {
  PROGRAM_MAIL_BATCH_DEADLINE_MS,
  PROGRAM_MAIL_BATCH_DRAIN_MS,
  PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
  PROGRAM_MAIL_LEASE_SAFETY_MARGIN_MS,
  PROGRAM_MAIL_POLL_INTERVAL_MS,
} from './program-mail.config';
import {
  ProgramMailDeliveryRepository,
  type ProgramMailRecipientDeliveryState,
} from './program-mail-delivery.repository';
import type {
  ProgramMailBatchWork,
  ProgramMailClock,
  ProgramMailProcessResult,
} from './program-mail-send.types';
import {
  type ProgramMailBatchScope,
  ProgramMailTransportService,
} from './program-mail-transport.service';

const SYSTEM_CLOCK: ProgramMailClock = () => new Date();

@Injectable()
export class ProgramMailWorkerService {
  private readonly sequential = new SequentialRepository();
  private readonly logger = new Logger(ProgramMailWorkerService.name);
  private readonly workerId = `program-mail-${randomUUID()}`;
  private running = false;

  constructor(
    @Inject(ProgramMailBatchRepository)
    private readonly batches: Pick<
      ProgramMailBatchRepository,
      'claim' | 'renew' | 'complete' | 'findRecoverableBatchKeys'
    >,
    @Inject(ProgramMailDeliveryRepository)
    private readonly deliveries: Pick<
      ProgramMailDeliveryRepository,
      | 'states'
      | 'claim'
      | 'complete'
      | 'markUnknown'
      | 'markClaimedUnknown'
      | 'result'
    >,
    @Inject(ProgramMailTransportService)
    private readonly transport: Pick<ProgramMailTransportService, 'runBatch'>,
  ) {}

  @Interval('program-mail-delivery', PROGRAM_MAIL_POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runBatch();
    } catch (error: unknown) {
      this.logger.error({
        event: 'program-mail.poll.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.running = false;
    }
  }

  async runBatch(clock: ProgramMailClock = SYSTEM_CLOCK): Promise<void> {
    const keys = await this.batches.findRecoverableBatchKeys(clock());
    await this.sequential.forEach(keys, async (batchKey) => {
      await this.process(batchKey, clock);
    });
  }

  async process(
    batchKey: string,
    clock: ProgramMailClock = SYSTEM_CLOCK,
  ): Promise<ProgramMailProcessResult> {
    const claimed = await this.batches.claim(batchKey, this.workerId, clock());
    if ('kind' in claimed) return claimed;
    const delivered = await this.deliver(claimed, clock);
    if (delivered === null) return { kind: 'IN_PROGRESS', batchKey };
    const result = await this.deliveries.result(delivered);
    return result === null
      ? { kind: 'IN_PROGRESS', batchKey }
      : this.batches.complete(delivered, result, clock());
  }

  private async deliver(
    work: ProgramMailBatchWork,
    clock: ProgramMailClock,
  ): Promise<ProgramMailBatchWork | null> {
    const states = await this.deliveries.states(work);
    const batches = Array.from(
      { length: Math.ceil(states.length / PROGRAM_MAIL_DELIVERY_BATCH_SIZE) },
      (_, index) =>
        states.slice(
          index * PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
          (index + 1) * PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
        ),
    );
    let current = work;
    let leaseOwned = true;
    await this.sequential.forEach(batches, async (batch) => {
      const renewed = await this.batches.renew(current, clock());
      if (renewed === null) {
        leaseOwned = false;
        return 'stop';
      }
      current = renewed;
      const remainingLeaseMs =
        current.leaseExpiresAt.getTime() - clock().getTime();
      if (
        remainingLeaseMs <=
        PROGRAM_MAIL_BATCH_DEADLINE_MS +
          PROGRAM_MAIL_BATCH_DRAIN_MS +
          PROGRAM_MAIL_LEASE_SAFETY_MARGIN_MS
      ) {
        leaseOwned = false;
        return 'stop';
      }
      const results = await this.transport.runBatch(
        batch.map(
          (state) => (scope) => this.deliverOne(current, state, clock, scope),
        ),
      );
      const ownership = await Promise.all(
        results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return Promise.resolve(result.value);
          }
          const state = batch[index];
          this.logger.error({
            event:
              result.status === 'rejected'
                ? 'program-mail.batch-task.failed'
                : 'program-mail.batch-task.drain-timeout',
            batchKey: current.batchKey,
            recipientId: state?.recipient.id,
            errorName:
              result.status === 'rejected' && result.reason instanceof Error
                ? result.reason.name
                : undefined,
          });
          return state === undefined
            ? Promise.resolve(false)
            : this.deliveries
                .markClaimedUnknown(current, state, clock())
                .catch((error: unknown) => {
                  this.logger.error({
                    event: 'program-mail.batch-task.unknown-write-failed',
                    batchKey: current.batchKey,
                    recipientId: state.recipient.id,
                    errorName:
                      error instanceof Error ? error.name : 'UnknownError',
                  });
                  return false;
                });
        }),
      );
      if (ownership.some((owned) => !owned)) {
        leaseOwned = false;
        return 'stop';
      }
    });
    return leaseOwned ? current : null;
  }

  private async deliverOne(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
    clock: ProgramMailClock,
    scope: ProgramMailBatchScope,
  ): Promise<boolean> {
    if (state.status === 'SENT' || state.status === 'FAILED') return true;
    if (state.status === 'PROCESSING') {
      const now = clock();
      return state.leaseExpiresAt === null || state.leaseExpiresAt <= now
        ? this.deliveries.markUnknown(work, state, now)
        : true;
    }
    if (state.status !== 'PENDING' || !work.deliveryAllowed) return true;
    if (!(await this.deliveries.claim(work, state, clock()))) return false;
    try {
      await scope.send(work, state);
      scope.signal.throwIfAborted();
    } catch {
      if (scope.signal.aborted) {
        return this.deliveries.markClaimedUnknown(work, state, clock());
      }
      const owned = await this.deliveries.complete({
        work,
        state,
        status: 'FAILED',
        now: clock(),
      });
      this.logger.error({
        event: 'program-mail.delivery.failed',
        batchKey: work.batchKey,
        recipientId: state.recipient.id,
      });
      return owned;
    }
    return this.deliveries.complete({
      work,
      state,
      status: 'SENT',
      now: clock(),
    });
  }
}
