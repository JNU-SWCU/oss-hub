import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';
import type {
  ProgramMailBatchContent,
  ProgramMailDeliveryResult,
  ProgramMailRecipient,
} from './program-mail-send.types';

@Injectable()
export class ProgramMailBatchPayloadRepository {
  content(value: Prisma.JsonValue, batchKey: string): ProgramMailBatchContent {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.actorId !== 'string' ||
      typeof value.programId !== 'string' ||
      typeof value.programName !== 'string' ||
      typeof value.senderName !== 'string' ||
      typeof value.subject !== 'string' ||
      typeof value.body !== 'string' ||
      typeof value.bodyHash !== 'string' ||
      typeof value.bodyLength !== 'number' ||
      typeof value.previewVersion !== 'string' ||
      typeof value.occurredAt !== 'string' ||
      !Array.isArray(value.recipients)
    ) {
      throw new ProgramMailStoredResultError(batchKey);
    }
    const recipients = value.recipients.flatMap((recipient) =>
      this.recipient(recipient),
    );
    if (recipients.length !== value.recipients.length) {
      throw new ProgramMailStoredResultError(batchKey);
    }
    return {
      actorId: value.actorId,
      programId: value.programId,
      programName: value.programName,
      senderName: value.senderName,
      subject: value.subject,
      body: value.body,
      bodyHash: value.bodyHash,
      bodyLength: value.bodyLength,
      previewVersion: value.previewVersion,
      occurredAt: new Date(value.occurredAt),
      recipients,
    };
  }

  payload(input: ProgramMailBatchContent): Prisma.InputJsonObject {
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
      occurredAt: input.occurredAt.toISOString(),
      recipients: input.recipients.map((recipient) => ({ ...recipient })),
    };
  }

  lease(value: Prisma.JsonValue): {
    readonly workerId: string;
    readonly token: string | null;
    readonly expiresAt: Date;
  } | null {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.workerId !== 'string' ||
      typeof value.leaseExpiresAt !== 'string'
    ) {
      return null;
    }
    return {
      workerId: value.workerId,
      token: typeof value.leaseToken === 'string' ? value.leaseToken : null,
      expiresAt: new Date(value.leaseExpiresAt),
    };
  }

  storedResult(
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
    return result !== null &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      typeof result.sentCount === 'number' &&
      typeof result.duplicateCount === 'number' &&
      typeof result.failedCount === 'number'
      ? {
          sentCount: result.sentCount,
          duplicateCount: result.duplicateCount,
          failedCount: result.failedCount,
          unknownCount:
            typeof result.unknownCount === 'number' ? result.unknownCount : 0,
        }
      : null;
  }

  private recipient(value: Prisma.JsonValue): readonly ProgramMailRecipient[] {
    return value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.id === 'string' &&
      typeof value.displayName === 'string' &&
      typeof value.notificationEmail === 'string'
      ? [
          {
            id: value.id,
            displayName: value.displayName,
            notificationEmail: value.notificationEmail,
          },
        ]
      : [];
  }
}
