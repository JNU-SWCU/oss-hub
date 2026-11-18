import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SequentialRepository } from '../platform/sequential.repository';
import { ProgramMailBatchRepository } from './program-mail-batch.repository';
import {
  PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
  PROGRAM_MAIL_POLL_INTERVAL_MS,
} from './program-mail.config';
import {
  ProgramMailDeliveryRepository,
  type ProgramMailRecipientDeliveryState,
} from './program-mail-delivery.repository';
import type {
  ProgramMailBatchWork,
  ProgramMailProcessResult,
} from './program-mail-send.types';
import { ProgramMailTransportService } from './program-mail-transport.service';

@Injectable()
export class ProgramMailWorkerService {
  private readonly sequential = new SequentialRepository();
  private readonly logger = new Logger(ProgramMailWorkerService.name);
  private readonly workerId = `program-mail-${randomUUID()}`;
  private running = false;

  constructor(
    private readonly batches: ProgramMailBatchRepository,
    private readonly deliveries: ProgramMailDeliveryRepository,
    private readonly transport: ProgramMailTransportService,
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

  async runBatch(now = new Date()): Promise<void> {
    const keys = await this.batches.findRecoverableBatchKeys(now);
    await this.sequential.forEach(keys, async (batchKey) => {
      await this.process(batchKey, now);
    });
  }

  async process(
    batchKey: string,
    now = new Date(),
  ): Promise<ProgramMailProcessResult> {
    const claimed = await this.batches.claim(batchKey, this.workerId, now);
    if ('kind' in claimed) return claimed;
    await this.deliver(claimed, now);
    const result = await this.deliveries.result(claimed);
    return result === null
      ? { kind: 'IN_PROGRESS', batchKey }
      : this.batches.complete(claimed, result, now);
  }

  private async deliver(work: ProgramMailBatchWork, now: Date): Promise<void> {
    const states = await this.deliveries.states(work);
    const batches = Array.from(
      { length: Math.ceil(states.length / PROGRAM_MAIL_DELIVERY_BATCH_SIZE) },
      (_, index) =>
        states.slice(
          index * PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
          (index + 1) * PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
        ),
    );
    await this.sequential.forEach(batches, async (batch) => {
      await Promise.all(
        batch.map((state) => this.deliverOne(work, state, now)),
      );
    });
  }

  private async deliverOne(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
    now: Date,
  ): Promise<void> {
    if (state.status === 'SENT' || state.status === 'FAILED') return;
    if (state.status === 'PROCESSING') {
      if (state.leaseExpiresAt === null || state.leaseExpiresAt <= now) {
        await this.deliveries.markUnknown(work, state);
      }
      return;
    }
    if (state.status !== 'PENDING') return;
    if (!(await this.deliveries.claim(work, state, now))) return;
    try {
      await this.transport.send(work, state);
    } catch {
      await this.deliveries.complete({ work, state, status: 'FAILED', now });
      this.logger.error({
        event: 'program-mail.delivery.failed',
        batchKey: work.batchKey,
        recipientId: state.recipient.id,
      });
      return;
    }
    await this.deliveries.complete({ work, state, status: 'SENT', now });
  }
}
