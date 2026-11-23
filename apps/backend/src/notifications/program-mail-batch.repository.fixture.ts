import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { ProgramMailAuditRepository } from './program-mail-audit.repository';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import {
  PROGRAM_MAIL_ACTIVE_SEND_LIMIT,
  PROGRAM_MAIL_LEASE_MS,
  PROGRAM_MAIL_WORKER_BATCH_SIZE,
} from './program-mail.config';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';
import type {
  ProgramMailBatchContent,
  ProgramMailBatchWork,
  ProgramMailDeliveryResult,
  ProgramMailProcessResult,
} from './program-mail-send.types';

@Injectable()
export class ProgramMailBatchRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly audit: ProgramMailAuditRepository,
    private readonly payloads: ProgramMailBatchPayloadRepository,
  ) {}

  claim(
    batchKey: string,
    workerId: string,
    now: Date,
  ): Promise<ProgramMailBatchWork | ProgramMailProcessResult> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `batch:${batchKey}`);
      await this.lock(transaction, 'active-claim');
      const batch = await transaction.notification.findUnique({
        where: { idempotencyKey: batchKey },
        select: { status: true, payload: true },
      });
      if (batch === null) throw new ProgramMailStoredResultError(batchKey);
      const completed = this.payloads.storedResult(batch.status, batch.payload);
      if (completed !== null) {
        return { kind: 'COMPLETED', batchKey, result: completed };
      }
      const content = this.payloads.content(batch.payload, batchKey);
      const lease = this.payloads.lease(batch.payload);
      if (
        batch.status === 'PROCESSING' &&
        lease !== null &&
        lease.expiresAt > now
      ) {
        return { kind: 'IN_PROGRESS', batchKey };
      }
      const program = await transaction.program.findUnique({
        where: { id: content.programId },
        select: { lifecycle: true },
      });
      const deliveryAllowed = program?.lifecycle === 'PUBLISHED';
      if (!deliveryAllowed) {
        await this.cancelPendingRecipients(transaction, content, batchKey);
      } else {
        const [active] = await transaction.$queryRaw<
          readonly { readonly count: number }[]
        >`
          SELECT count(*)::int AS count
          FROM "Notification"
          WHERE "type" = 'PROGRAM_MAIL_SEND'
            AND "status" = 'PROCESSING'
            AND COALESCE((payload->>'deliveryAllowed')::boolean, true)
            AND (payload->>'leaseExpiresAt')::timestamptz > ${now}
          LIMIT 1
        `;
        if ((active?.count ?? 0) >= PROGRAM_MAIL_ACTIVE_SEND_LIMIT) {
          return { kind: 'IN_PROGRESS', batchKey };
        }
      }
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + PROGRAM_MAIL_LEASE_MS);
      const claimed = await transaction.notification.updateMany({
        where: {
          idempotencyKey: batchKey,
          status: batch.status,
          ...(lease?.token === null || lease === null
            ? {}
            : { payload: { path: ['leaseToken'], equals: lease.token } }),
        },
        data: {
          status: 'PROCESSING',
          payload: {
            ...this.payloads.payload(content),
            workerId,
            leaseToken,
            leaseExpiresAt: leaseExpiresAt.toISOString(),
            deliveryAllowed,
          },
        },
      });
      return claimed.count === 1
        ? {
            ...content,
            batchKey,
            workerId,
            leaseToken,
            leaseExpiresAt,
            deliveryAllowed,
          }
        : { kind: 'IN_PROGRESS', batchKey };
    });
  }

  async renew(
    work: ProgramMailBatchWork,
    now: Date,
  ): Promise<ProgramMailBatchWork | null> {
    const leaseExpiresAt = new Date(now.getTime() + PROGRAM_MAIL_LEASE_MS);
    const updated = await this.prisma.$executeRaw`
      UPDATE "Notification" AS batch
      SET payload = jsonb_set(
        batch.payload,
        '{leaseExpiresAt}',
        to_jsonb(${leaseExpiresAt.toISOString()}::text),
        true
      )
      WHERE batch."idempotencyKey" = ${work.batchKey}
        AND batch."type" = 'PROGRAM_MAIL_SEND'
        AND batch."status" = 'PROCESSING'
        AND batch.payload->>'workerId' = ${work.workerId}
        AND batch.payload->>'leaseToken' = ${work.leaseToken}
        AND (batch.payload->>'leaseExpiresAt')::timestamptz > ${now}
        AND (
          batch.payload->>'deliveryAllowed' = 'false'
          OR EXISTS (
            SELECT 1
            FROM "Program" AS program
            WHERE program.id = batch.payload->>'programId'
              AND program.lifecycle <> 'DELETED'
          )
        )
    `;
    return updated === 1 ? { ...work, leaseExpiresAt } : null;
  }

  complete(
    work: ProgramMailBatchWork,
    result: ProgramMailDeliveryResult,
    now: Date,
  ): Promise<ProgramMailProcessResult> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lock(transaction, `batch:${work.batchKey}`);
      const batch = await transaction.notification.findUnique({
        where: { idempotencyKey: work.batchKey },
        select: { status: true, payload: true },
      });
      if (batch === null) throw new ProgramMailStoredResultError(work.batchKey);
      const completed = this.payloads.storedResult(batch.status, batch.payload);
      if (completed !== null) {
        return {
          kind: 'COMPLETED',
          batchKey: work.batchKey,
          result: completed,
        };
      }
      const unresolved = await transaction.notification.count({
        where: {
          type: 'PROGRAM_MAIL',
          status: { in: ['PENDING', 'PROCESSING'] },
          payload: { path: ['batchKey'], equals: work.batchKey },
        },
      });
      if (unresolved > 0) {
        return { kind: 'IN_PROGRESS', batchKey: work.batchKey };
      }
      const completedPayload = JSON.stringify({
        schemaVersion: 1,
        programId: work.programId,
        previewVersion: work.previewVersion,
        result,
      });
      const updated = await transaction.$executeRaw`
        UPDATE "Notification" AS batch
        SET "status" = 'COMPLETED',
            "sentAt" = ${now},
            payload = ${completedPayload}::jsonb
        WHERE batch."idempotencyKey" = ${work.batchKey}
          AND batch."type" = 'PROGRAM_MAIL_SEND'
          AND batch."status" = 'PROCESSING'
          AND batch.payload->>'workerId' = ${work.workerId}
          AND batch.payload->>'leaseToken' = ${work.leaseToken}
          AND (batch.payload->>'leaseExpiresAt')::timestamptz > ${now}
      `;
      if (updated !== 1) {
        return { kind: 'IN_PROGRESS', batchKey: work.batchKey };
      }
      await this.audit.recordResult(
        { input: work, batchKey: work.batchKey, result, occurredAt: now },
        transaction,
      );
      return { kind: 'COMPLETED', batchKey: work.batchKey, result };
    });
  }

  async findRecoverableBatchKeys(now: Date): Promise<readonly string[]> {
    const rows = await this.prisma.$queryRaw<
      readonly { readonly idempotencyKey: string }[]
    >`
      SELECT "idempotencyKey"
      FROM "Notification"
      WHERE "type" = 'PROGRAM_MAIL_SEND'
        AND (
          "status" = 'PENDING'
          OR (
            "status" = 'PROCESSING'
            AND (payload->>'leaseExpiresAt')::timestamptz <= ${now}
          )
        )
        AND "idempotencyKey" IS NOT NULL
      ORDER BY "createdAt" ASC, id ASC
      LIMIT ${PROGRAM_MAIL_WORKER_BATCH_SIZE}
    `;
    return rows.map((row) => row.idempotencyKey);
  }

  private cancelPendingRecipients(
    transaction: Prisma.TransactionClient,
    content: ProgramMailBatchContent,
    batchKey: string,
  ): Promise<unknown> {
    return transaction.notification.updateMany({
      where: {
        type: 'PROGRAM_MAIL',
        status: 'PENDING',
        payload: { path: ['batchKey'], equals: batchKey },
      },
      data: {
        status: 'FAILED',
        payload: {
          schemaVersion: 1,
          batchKey,
          previewVersion: content.previewVersion,
          code: 'PROGRAM_DELETED',
        },
      },
    });
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
}
