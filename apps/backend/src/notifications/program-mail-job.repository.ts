import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';

const PAGE_SIZE = 10;
const receiptSources = (programId: string) => Prisma.sql`
  SELECT id, "createdAt" FROM "Notification"
  WHERE type = 'PROGRAM_MAIL_SEND' AND channel = 'INTERNAL' AND payload->>'programId' = ${programId}
  UNION ALL
  SELECT id, "createdAt" FROM "MailJob" job
  WHERE "programId" = ${programId} AND "partNo" = 0 AND "receiptFinishedAt" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Notification" legacy WHERE legacy.id = job.id)
`;
const notFound = () =>
  new DomainException(
    NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.MAIL_JOB_NOT_FOUND],
  );

@Injectable()
export class ProgramMailJobRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payloads: ProgramMailBatchPayloadRepository,
  ) {}

  async recent(programId: string, before?: string) {
    const source = receiptSources(programId);
    const anchor =
      before === undefined
        ? null
        : (
            await this.prisma.$queryRaw<{ createdAt: Date; id: string }[]>`
            SELECT id, "createdAt" FROM (${source}) receipts WHERE id = ${before} LIMIT 1
          `
          )[0];
    if (before !== undefined && !anchor) throw notFound();
    const rows = await this.prisma.$queryRaw<{ createdAt: Date; id: string }[]>`
      SELECT id, "createdAt" FROM (${source}) receipts
      WHERE ${anchor === null || anchor === undefined}
        OR ("createdAt", id) < (${anchor?.createdAt ?? null}::timestamp, ${anchor?.id ?? null}::text)
      ORDER BY "createdAt" DESC, id DESC LIMIT ${PAGE_SIZE + 1}
    `;
    const items = rows.slice(0, PAGE_SIZE).map((row) => ({
      jobId: row.id,
      acceptedAt: row.createdAt.toISOString(),
    }));
    return {
      items,
      nextCursor: rows.length > PAGE_SIZE ? items.at(-1)?.jobId : undefined,
    };
  }

  async status(programId: string, jobId: string) {
    const [batch] = await this.prisma.$queryRaw<
      {
        createdAt: Date;
        sentAt: Date | null;
        status: string;
        result: Prisma.JsonValue;
      }[]
    >`
      SELECT "createdAt", "sentAt", status, result FROM (
        SELECT "createdAt", "sentAt", status, payload->'result' AS result, 0 AS priority
        FROM "Notification"
        WHERE id = ${jobId} AND type = 'PROGRAM_MAIL_SEND' AND channel = 'INTERNAL'
          AND payload->>'programId' = ${programId}
        UNION ALL
        SELECT "createdAt", "receiptFinishedAt", 'COMPLETED' AS status, result, 1 AS priority
        FROM "MailJob"
        WHERE id = ${jobId} AND "receiptId" = id AND "partNo" = 0
          AND "programId" = ${programId} AND "receiptFinishedAt" IS NOT NULL
      ) receipts ORDER BY priority
      LIMIT 1
    `;
    if (!batch) throw notFound();
    const receipt = { jobId, acceptedAt: batch.createdAt.toISOString() };
    if (batch.status === 'PENDING' || batch.status === 'PROCESSING') {
      return {
        ...receipt,
        status:
          batch.status === 'PENDING'
            ? ('QUEUED' as const)
            : ('IN_PROGRESS' as const),
      };
    }
    const result = this.payloads.storedResult(batch.status, {
      result: batch.result,
    });
    if (!result || !batch.sentAt) throw new ProgramMailStoredResultError(jobId);
    return {
      ...receipt,
      status: 'COMPLETED' as const,
      finishedAt: batch.sentAt.toISOString(),
      ...result,
    };
  }
}
