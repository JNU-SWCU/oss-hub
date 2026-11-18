import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type ProgramMailAuditInput = {
  readonly actorId: string;
  readonly programId: string;
  readonly programName: string;
  readonly recipientIds: readonly string[];
  readonly subject: string;
  readonly bodyHash: string;
  readonly bodyLength: number;
  readonly idempotencyKey: string;
  readonly occurredAt: Date;
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

type ProgramMailAuditTransaction = Pick<
  Prisma.TransactionClient,
  'userHistory'
>;

@Injectable()
export class ProgramMailAuditRepository {
  recordSend(
    input: ProgramMailAuditInput,
    transaction: ProgramMailAuditTransaction,
  ): Promise<unknown> {
    return transaction.userHistory.create({
      data: {
        id: `user:program-mail:${input.idempotencyKey}`,
        userId: input.actorId,
        actorId: input.actorId,
        event: 'PROFILE_UPDATED',
        source: 'APPLICATION',
        sourceTable: 'ProgramMail',
        sourceId: input.idempotencyKey,
        sourcePart: 'whole',
        occurredAt: input.occurredAt,
        data: {
          schemaVersion: 1,
          recordKind: 'DOMAIN_EVENT',
          action: 'PROGRAM_MAIL_SENT',
          targetType: 'PROGRAM',
          targetId: input.programId,
          requestId: input.idempotencyKey,
          metadata: {
            schemaVersion: 1,
            programName: input.programName,
            recipientCount: input.recipientIds.length,
            recipientIds: [...input.recipientIds],
            subject: input.subject,
            bodyHash: input.bodyHash,
            bodyLength: input.bodyLength,
            idempotencyKey: input.idempotencyKey,
            sentCount: input.sentCount,
            duplicateCount: input.duplicateCount,
            failedCount: input.failedCount,
          },
          request: null,
        },
      },
    });
  }
}
