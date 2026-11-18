import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { ProgramMailKeyRepository } from './program-mail-key.repository';
import {
  PROGRAM_MAIL_PROGRAM_SEND_LIMIT,
  PROGRAM_MAIL_RATE_WINDOW_MS,
  PROGRAM_MAIL_STAFF_SEND_LIMIT,
} from './program-mail.config';
import {
  type ProgramMailBatchContent,
  type ProgramMailDeliveryResult,
  type ProgramMailReservation,
} from './program-mail-send.types';

@Injectable()
export class ProgramMailSendRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly audit: ProgramMailAuditRepository,
    private readonly keys: ProgramMailKeyRepository,
  ) {}

  reserve(input: ProgramMailBatchContent): Promise<ProgramMailReservation> {
    const batchKey = `program-mail-send:${input.previewVersion}`;
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `batch:${batchKey}`);
      const existing = await transaction.notification.findUnique({
        where: { idempotencyKey: batchKey },
        select: { status: true, payload: true },
      });
      if (existing !== null) {
        const result = this.storedResult(existing.status, existing.payload);
        return result === null
          ? { kind: 'IN_PROGRESS', batchKey }
          : { kind: 'COMPLETED', batchKey, result };
      }

      await this.lock(transaction, `actor:${input.actorId}`);
      await this.lock(transaction, `program:${input.programId}`);
      const threshold = new Date(
        input.occurredAt.getTime() - PROGRAM_MAIL_RATE_WINDOW_MS,
      );
      const staffAttempts = await transaction.notification.count({
        where: {
          type: 'PROGRAM_MAIL_SEND',
          userId: input.actorId,
          createdAt: { gte: threshold },
        },
      });
      const programAttempts = await transaction.notification.count({
        where: {
          type: 'PROGRAM_MAIL_SEND',
          createdAt: { gte: threshold },
          payload: { path: ['programId'], equals: input.programId },
        },
      });
      if (
        staffAttempts >= PROGRAM_MAIL_STAFF_SEND_LIMIT ||
        programAttempts >= PROGRAM_MAIL_PROGRAM_SEND_LIMIT
      ) {
        this.fail(NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED);
      }

      await transaction.notification.create({
        data: {
          userId: input.actorId,
          idempotencyKey: batchKey,
          type: 'PROGRAM_MAIL_SEND',
          channel: 'INTERNAL',
          status: 'PENDING',
          payload: this.batchPayload(input),
        },
      });
      await transaction.notification.createMany({
        data: input.recipients.map((recipient) => ({
          userId: recipient.id,
          idempotencyKey: this.keys.delivery(
            input.previewVersion,
            recipient.id,
          ),
          type: 'PROGRAM_MAIL',
          channel: 'EMAIL',
          status: 'PENDING',
          payload: {
            schemaVersion: 1,
            batchKey,
            previewVersion: input.previewVersion,
            displayName: recipient.displayName,
            notificationEmail: recipient.notificationEmail,
            workerId: null,
            leaseExpiresAt: null,
          },
        })),
      });
      await this.audit.recordAttempt({ input, batchKey }, transaction);
      return { kind: 'OWNER', batchKey };
    });
  }

  private batchPayload(input: ProgramMailBatchContent): Prisma.InputJsonObject {
    return {
      schemaVersion: 1,
      actorId: input.actorId,
      programId: input.programId,
      programName: input.programName,
      senderName: input.senderName,
      subject: input.subject,
      body: input.body,
      bodyHash: input.bodyHash,
      bodyLength: input.bodyLength,
      previewVersion: input.previewVersion,
      recipients: input.recipients.map((recipient) => ({ ...recipient })),
      occurredAt: input.occurredAt.toISOString(),
      workerId: null,
      leaseExpiresAt: null,
    };
  }

  private lock(
    transaction: Prisma.TransactionClient,
    key: string,
  ): Promise<unknown> {
    return transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`program-mail:${key}`}, 0))
      LIMIT 1
    `;
  }

  private storedResult(
    status: string,
    payload: Prisma.JsonValue,
  ): ProgramMailDeliveryResult | null {
    if (
      status !== 'COMPLETED' ||
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !('result' in payload)
    ) {
      return null;
    }
    const result = payload.result;
    if (
      result === null ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      typeof result.sentCount !== 'number' ||
      typeof result.duplicateCount !== 'number' ||
      typeof result.failedCount !== 'number'
    ) {
      return null;
    }
    return {
      sentCount: result.sentCount,
      duplicateCount: result.duplicateCount,
      failedCount: result.failedCount,
    };
  }

  private fail(code: NotificationsErrorCode): never {
    throw new DomainException(NOTIFICATIONS_ERROR_CODES[code]);
  }
}
