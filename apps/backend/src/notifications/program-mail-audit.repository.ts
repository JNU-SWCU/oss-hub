import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ProgramMailBatchContent,
  ProgramMailDeliveryResult,
} from './program-mail-send.types';

type ProgramMailAuditTransaction = Pick<
  Prisma.TransactionClient,
  'userHistory'
>;

type ProgramMailAuditRecord = {
  readonly id: string;
  readonly action: string;
  readonly sourcePart: 'attempt' | 'result';
  readonly metadata: Prisma.InputJsonObject;
};

@Injectable()
export class ProgramMailAuditRepository {
  recordAttempt(
    command: {
      readonly input: ProgramMailBatchContent;
      readonly batchKey: string;
    },
    transaction: ProgramMailAuditTransaction,
  ): Promise<unknown> {
    return this.record(
      {
        input: command.input,
        batchKey: command.batchKey,
        occurredAt: command.input.occurredAt,
        record: {
          id: `user:program-mail-attempt:${command.batchKey}`,
          action: 'PROGRAM_MAIL_SEND_ATTEMPTED',
          sourcePart: 'attempt',
          metadata: this.metadata(command.input, command.batchKey),
        },
      },
      transaction,
    );
  }

  recordResult(
    command: {
      readonly input: ProgramMailBatchContent;
      readonly batchKey: string;
      readonly result: ProgramMailDeliveryResult;
      readonly occurredAt: Date;
    },
    transaction: ProgramMailAuditTransaction,
  ): Promise<unknown> {
    return this.record(
      {
        input: command.input,
        batchKey: command.batchKey,
        occurredAt: command.occurredAt,
        record: {
          id: `user:program-mail-result:${command.batchKey}`,
          action: this.resultAction(command.result),
          sourcePart: 'result',
          metadata: {
            ...this.metadata(command.input, command.batchKey),
            ...command.result,
          },
        },
      },
      transaction,
    );
  }

  private resultAction(result: ProgramMailDeliveryResult): string {
    if (result.unknownCount > 0) return 'PROGRAM_MAIL_DELIVERY_UNKNOWN';
    if (result.failedCount === 0) return 'PROGRAM_MAIL_SENT';
    if (result.sentCount + result.duplicateCount > 0)
      return 'PROGRAM_MAIL_PARTIALLY_FAILED';
    return 'PROGRAM_MAIL_FAILED';
  }

  private record(
    command: {
      readonly input: ProgramMailBatchContent;
      readonly batchKey: string;
      readonly occurredAt: Date;
      readonly record: ProgramMailAuditRecord;
    },
    transaction: ProgramMailAuditTransaction,
  ): Promise<unknown> {
    return this.recordEvent(transaction, {
      ...command.record,
      sourceTable: 'ProgramMail',
      actorId: command.input.actorId,
      programId: command.input.programId,
      requestId: command.batchKey,
      occurredAt: command.occurredAt,
    });
  }

  recordEvent(
    transaction: ProgramMailAuditTransaction,
    entry: ProgramMailAuditRecord & {
      readonly actorId: string;
      readonly programId: string;
      readonly requestId: string;
      readonly occurredAt: Date;
      readonly sourceTable: 'ProgramMail' | 'DeadlineDigest';
    },
  ): Promise<unknown> {
    return transaction.userHistory.create({
      data: {
        id: entry.id,
        userId: entry.actorId,
        actorId: entry.actorId,
        event: 'PROFILE_UPDATED',
        source: 'APPLICATION',
        sourceTable: entry.sourceTable,
        sourceId: entry.requestId,
        sourcePart: entry.sourcePart,
        occurredAt: entry.occurredAt,
        data: {
          schemaVersion: 1,
          recordKind: 'DOMAIN_EVENT',
          action: entry.action,
          targetType: 'PROGRAM',
          targetId: entry.programId,
          requestId: entry.requestId,
          metadata: entry.metadata,
          request: null,
        },
      },
    });
  }

  private metadata(
    input: ProgramMailBatchContent,
    batchKey: string,
  ): Prisma.InputJsonObject {
    return {
      schemaVersion: 1,
      senderId: input.actorId,
      senderName: input.senderName,
      programId: input.programId,
      programName: input.programName,
      recipientCount: input.recipients.length,
      recipientIds: input.recipients.map((recipient) => recipient.id),
      subject: input.subject,
      bodyHash: input.bodyHash,
      bodyLength: input.bodyLength,
      idempotencyKey: batchKey,
    };
  }
}
