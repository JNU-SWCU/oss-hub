import { Inject, Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import {
  ProgramMailDeliveryRepository,
  type ProgramMailDeliveryResult,
  type ProgramMailDeliveryStore,
} from './program-mail-delivery.repository';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';
import {
  PROGRAM_MAIL_PROGRAM_SEND_LIMIT,
  PROGRAM_MAIL_RATE_WINDOW_MS,
  PROGRAM_MAIL_STAFF_SEND_LIMIT,
} from './program-mail.config';

export type { ProgramMailDeliveryResult };

type ProgramMailBatchInput = {
  readonly actorId: string;
  readonly programId: string;
  readonly programName: string;
  readonly recipientIds: readonly string[];
  readonly subject: string;
  readonly bodyHash: string;
  readonly bodyLength: number;
  readonly previewVersion: string;
  readonly occurredAt: Date;
};

@Injectable()
export class ProgramMailSendRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly audit: ProgramMailAuditRepository,
    private readonly deliveries: ProgramMailDeliveryRepository,
  ) {}

  run(
    input: ProgramMailBatchInput,
    deliver: (
      transaction: ProgramMailDeliveryStore,
    ) => Promise<ProgramMailDeliveryResult>,
  ): Promise<ProgramMailDeliveryResult> {
    const idempotencyKey = `program-mail-send:${input.previewVersion}`;
    return this.prisma.$transaction(
      async (transaction) => {
        await this.lock(transaction, `batch:${idempotencyKey}`);
        const existing = await transaction.notification.findUnique({
          where: { idempotencyKey },
          select: { status: true, payload: true },
        });
        if (existing !== null) {
          const result = this.storedResult(existing.status, existing.payload);
          if (result === null) {
            throw new ProgramMailStoredResultError(idempotencyKey);
          }
          return result;
        }

        await this.lock(transaction, `actor:${input.actorId}`);
        await this.lock(transaction, `program:${input.programId}`);
        const threshold = new Date(
          input.occurredAt.getTime() - PROGRAM_MAIL_RATE_WINDOW_MS,
        );
        const [staffAttempts, programAttempts] = await Promise.all([
          transaction.notification.count({
            where: {
              type: 'PROGRAM_MAIL_SEND',
              userId: input.actorId,
              createdAt: { gte: threshold },
            },
          }),
          transaction.notification.count({
            where: {
              type: 'PROGRAM_MAIL_SEND',
              createdAt: { gte: threshold },
              payload: { path: ['programId'], equals: input.programId },
            },
          }),
        ]);
        if (
          staffAttempts >= PROGRAM_MAIL_STAFF_SEND_LIMIT ||
          programAttempts >= PROGRAM_MAIL_PROGRAM_SEND_LIMIT
        ) {
          this.fail(NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED);
        }
        const slots = await transaction.$queryRaw<
          readonly { readonly slot: number | null }[]
        >`
          SELECT CASE
            WHEN pg_try_advisory_xact_lock(hashtextextended('program-mail:slot:0', 0)) THEN 0
            WHEN pg_try_advisory_xact_lock(hashtextextended('program-mail:slot:1', 0)) THEN 1
            ELSE NULL
          END AS slot
          LIMIT 1
        `;
        if (slots[0]?.slot === null || slots[0] === undefined) {
          this.fail(NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED);
        }

        await transaction.notification.create({
          data: {
            userId: input.actorId,
            idempotencyKey,
            type: 'PROGRAM_MAIL_SEND',
            channel: 'EMAIL',
            status: 'PENDING',
            payload: {
              schemaVersion: 1,
              programId: input.programId,
              previewVersion: input.previewVersion,
            },
          },
        });
        await deliver(this.deliveries);
        const result = await this.deliveries.result(
          input.previewVersion,
          input.recipientIds,
        );
        await this.audit.recordSend(
          {
            actorId: input.actorId,
            programId: input.programId,
            programName: input.programName,
            recipientIds: input.recipientIds,
            subject: input.subject,
            bodyHash: input.bodyHash,
            bodyLength: input.bodyLength,
            idempotencyKey,
            occurredAt: input.occurredAt,
            ...result,
          },
          transaction,
        );
        await transaction.notification.update({
          where: { idempotencyKey },
          data: {
            status: 'SENT',
            sentAt: input.occurredAt,
            payload: {
              schemaVersion: 1,
              programId: input.programId,
              previewVersion: input.previewVersion,
              result,
            },
          },
        });
        return result;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
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
      status !== 'SENT' ||
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
