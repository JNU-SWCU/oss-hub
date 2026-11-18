import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { PROGRAM_MAIL_LEASE_MS } from './program-mail.config';
import { ProgramMailKeyRepository } from './program-mail-key.repository';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';
import type {
  ProgramMailBatchWork,
  ProgramMailDeliveryResult,
  ProgramMailRecipient,
} from './program-mail-send.types';

export type ProgramMailRecipientDeliveryState = {
  readonly key: string;
  readonly recipient: ProgramMailRecipient;
  readonly status: string;
  readonly code: string | null;
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
          code: this.code(row.payload),
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
    const payload = JSON.stringify({
      schemaVersion: 1,
      batchKey: work.batchKey,
      previewVersion: work.previewVersion,
      displayName: state.recipient.displayName,
      notificationEmail: state.recipient.notificationEmail,
      workerId: work.workerId,
      leaseToken: work.leaseToken,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    });
    const updated = await this.prisma.$executeRaw`
      UPDATE "Notification" AS recipient
      SET "status" = 'PROCESSING', payload = ${payload}::jsonb
      WHERE recipient."idempotencyKey" = ${state.key}
        AND recipient."type" = 'PROGRAM_MAIL'
        AND recipient."status" = 'PENDING'
        AND EXISTS (
          SELECT 1
          FROM "Notification" AS batch
          INNER JOIN "Program" AS program
            ON program.id = batch.payload->>'programId'
          WHERE batch."idempotencyKey" = ${work.batchKey}
            AND batch."type" = 'PROGRAM_MAIL_SEND'
            AND batch."status" = 'PROCESSING'
            AND batch.payload->>'workerId' = ${work.workerId}
            AND batch.payload->>'leaseToken' = ${work.leaseToken}
            AND (batch.payload->>'leaseExpiresAt')::timestamptz > ${now}
            AND program.lifecycle <> 'DELETED'
        )
    `;
    return updated === 1;
  }

  async complete(command: {
    readonly work: ProgramMailBatchWork;
    readonly state: ProgramMailRecipientDeliveryState;
    readonly status: 'SENT' | 'FAILED';
    readonly now: Date;
  }): Promise<boolean> {
    const payload = JSON.stringify({
      schemaVersion: 1,
      batchKey: command.work.batchKey,
      previewVersion: command.work.previewVersion,
      code: command.status === 'SENT' ? null : 'MAIL_DELIVERY_FAILED',
    });
    const updated = await this.prisma.$executeRaw`
      UPDATE "Notification" AS recipient
      SET "status" = ${command.status},
          "sentAt" = ${command.status === 'SENT' ? command.now : null},
          payload = ${payload}::jsonb
      WHERE recipient."idempotencyKey" = ${command.state.key}
        AND recipient."type" = 'PROGRAM_MAIL'
        AND recipient."status" = 'PROCESSING'
        AND recipient.payload->>'workerId' = ${command.work.workerId}
        AND recipient.payload->>'leaseToken' = ${command.work.leaseToken}
        AND EXISTS (
          SELECT 1
          FROM "Notification" AS batch
          WHERE batch."idempotencyKey" = ${command.work.batchKey}
            AND batch."type" = 'PROGRAM_MAIL_SEND'
            AND batch."status" = 'PROCESSING'
            AND batch.payload->>'workerId' = ${command.work.workerId}
            AND batch.payload->>'leaseToken' = ${command.work.leaseToken}
            AND (batch.payload->>'leaseExpiresAt')::timestamptz > ${command.now}
        )
    `;
    return updated === 1;
  }

  async markUnknown(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
    now: Date,
  ): Promise<boolean> {
    const payload = JSON.stringify({
      schemaVersion: 1,
      batchKey: work.batchKey,
      previewVersion: work.previewVersion,
      code: 'MAIL_DELIVERY_UNKNOWN',
    });
    const updated = await this.prisma.$executeRaw`
      UPDATE "Notification" AS recipient
      SET "status" = 'FAILED', "sentAt" = NULL, payload = ${payload}::jsonb
      WHERE recipient."idempotencyKey" = ${state.key}
        AND recipient."type" = 'PROGRAM_MAIL'
        AND recipient."status" = 'PROCESSING'
        AND (recipient.payload->>'leaseExpiresAt')::timestamptz <= ${now}
        AND EXISTS (
          SELECT 1
          FROM "Notification" AS batch
          WHERE batch."idempotencyKey" = ${work.batchKey}
            AND batch."type" = 'PROGRAM_MAIL_SEND'
            AND batch."status" = 'PROCESSING'
            AND batch.payload->>'workerId' = ${work.workerId}
            AND batch.payload->>'leaseToken' = ${work.leaseToken}
            AND (batch.payload->>'leaseExpiresAt')::timestamptz > ${now}
        )
    `;
    return updated === 1;
  }

  async markClaimedUnknown(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
    now: Date,
  ): Promise<boolean> {
    const payload = JSON.stringify({
      schemaVersion: 1,
      batchKey: work.batchKey,
      previewVersion: work.previewVersion,
      code: 'MAIL_DELIVERY_UNKNOWN',
    });
    const updated = await this.prisma.$executeRaw`
      UPDATE "Notification" AS recipient
      SET "status" = 'FAILED', "sentAt" = NULL, payload = ${payload}::jsonb
      WHERE recipient."idempotencyKey" = ${state.key}
        AND recipient."type" = 'PROGRAM_MAIL'
        AND recipient."status" = 'PROCESSING'
        AND recipient.payload->>'workerId' = ${work.workerId}
        AND recipient.payload->>'leaseToken' = ${work.leaseToken}
        AND EXISTS (
          SELECT 1
          FROM "Notification" AS batch
          WHERE batch."idempotencyKey" = ${work.batchKey}
            AND batch."type" = 'PROGRAM_MAIL_SEND'
            AND batch."status" = 'PROCESSING'
            AND batch.payload->>'workerId' = ${work.workerId}
            AND batch.payload->>'leaseToken' = ${work.leaseToken}
            AND (batch.payload->>'leaseExpiresAt')::timestamptz > ${now}
        )
    `;
    return updated === 1;
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
    const unknownCount = states.filter(
      (state) =>
        state.status === 'FAILED' && state.code === 'MAIL_DELIVERY_UNKNOWN',
    ).length;
    const failedCount = states.filter(
      (state) =>
        state.status === 'FAILED' && state.code !== 'MAIL_DELIVERY_UNKNOWN',
    ).length;
    return { sentCount, failedCount, unknownCount, duplicateCount: 0 };
  }

  private leaseExpiry(value: Prisma.JsonValue): Date | null {
    return value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.leaseExpiresAt === 'string'
      ? new Date(value.leaseExpiresAt)
      : null;
  }

  private code(value: Prisma.JsonValue): string | null {
    return value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.code === 'string'
      ? value.code
      : null;
  }
}
