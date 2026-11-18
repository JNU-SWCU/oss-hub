import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PROGRAM_MAIL_LEASE_MS } from './program-mail.config';
import { ProgramMailKeyRepository } from './program-mail-key.repository';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';
import {
  type ProgramMailBatchWork,
  type ProgramMailDeliveryResult,
  type ProgramMailRecipient,
} from './program-mail-send.types';

export type ProgramMailRecipientDeliveryState = {
  readonly key: string;
  readonly recipient: ProgramMailRecipient;
  readonly status: string;
  readonly leaseExpiresAt: Date | null;
};

@Injectable()
export class ProgramMailDeliveryRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly keys: ProgramMailKeyRepository,
  ) {}

  async states(
    work: ProgramMailBatchWork,
  ): Promise<readonly ProgramMailRecipientDeliveryState[]> {
    const byKey = new Map(
      work.recipients.map((recipient) => [
        this.keys.delivery(work.previewVersion, recipient.id),
        recipient,
      ]),
    );
    const rows = await this.prisma.notification.findMany({
      take: byKey.size + 1,
      where: { idempotencyKey: { in: [...byKey.keys()] } },
      select: { idempotencyKey: true, status: true, payload: true },
      orderBy: { idempotencyKey: 'asc' },
    });
    if (rows.length !== byKey.size) {
      throw new ProgramMailStoredResultError(work.batchKey);
    }
    return rows.flatMap((row) => {
      const key = row.idempotencyKey;
      const recipient = key === null ? undefined : byKey.get(key);
      if (key === null || recipient === undefined) return [];
      return [
        {
          key,
          recipient,
          status: row.status,
          leaseExpiresAt: this.leaseExpiry(row.payload),
        },
      ];
    });
  }

  async claim(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
    now: Date,
  ): Promise<boolean> {
    const leaseExpiresAt = new Date(now.getTime() + PROGRAM_MAIL_LEASE_MS);
    const updated = await this.prisma.notification.updateMany({
      where: { idempotencyKey: state.key, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        payload: {
          schemaVersion: 1,
          batchKey: work.batchKey,
          previewVersion: work.previewVersion,
          displayName: state.recipient.displayName,
          notificationEmail: state.recipient.notificationEmail,
          workerId: work.workerId,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        },
      },
    });
    return updated.count === 1;
  }

  async complete(command: {
    readonly work: ProgramMailBatchWork;
    readonly state: ProgramMailRecipientDeliveryState;
    readonly status: 'SENT' | 'FAILED';
    readonly now: Date;
  }): Promise<void> {
    const updated = await this.prisma.notification.updateMany({
      where: {
        idempotencyKey: command.state.key,
        status: 'PROCESSING',
        payload: { path: ['workerId'], equals: command.work.workerId },
      },
      data: {
        status: command.status,
        sentAt: command.status === 'SENT' ? command.now : null,
        payload: {
          schemaVersion: 1,
          batchKey: command.work.batchKey,
          previewVersion: command.work.previewVersion,
          code: command.status === 'SENT' ? null : 'MAIL_DELIVERY_FAILED',
        },
      },
    });
    if (updated.count !== 1) {
      throw new ProgramMailStoredResultError(command.work.batchKey);
    }
  }

  async markUnknown(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
  ): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { idempotencyKey: state.key, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        sentAt: null,
        payload: {
          schemaVersion: 1,
          batchKey: work.batchKey,
          previewVersion: work.previewVersion,
          code: 'MAIL_DELIVERY_UNKNOWN',
        },
      },
    });
  }

  async result(
    work: ProgramMailBatchWork,
  ): Promise<ProgramMailDeliveryResult | null> {
    const states = await this.states(work);
    if (
      states.some(
        (state) => state.status === 'PENDING' || state.status === 'PROCESSING',
      )
    ) {
      return null;
    }
    const sentCount = states.filter((state) => state.status === 'SENT').length;
    const failedCount = states.filter(
      (state) => state.status === 'FAILED',
    ).length;
    return { sentCount, failedCount, duplicateCount: 0 };
  }

  private leaseExpiry(value: Prisma.JsonValue): Date | null {
    return value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.leaseExpiresAt === 'string'
      ? new Date(value.leaseExpiresAt)
      : null;
  }
}
