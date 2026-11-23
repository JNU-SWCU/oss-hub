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
  SELECT id, "createdAt", "sentAt", status, payload->'result' AS result, 'PROGRAM_MANUAL'::text AS source FROM "Notification" legacy
  WHERE type = 'PROGRAM_MAIL_SEND' AND channel = 'INTERNAL' AND payload->>'programId' = ${programId}
    AND NOT EXISTS (
      SELECT 1 FROM "MailJob" job WHERE job.id = legacy.id AND (
        job."receiptFinishedAt" IS NOT NULL OR job."legacySnapshotStatus" = 'COMPLETED'
        OR (SELECT mode FROM "MailControl" WHERE id = 1) = 'JOBS'
      )
    )
  UNION ALL
  SELECT id, "createdAt", "receiptFinishedAt",
    CASE WHEN "receiptFinishedAt" IS NOT NULL THEN 'COMPLETED' WHEN state = 'QUEUED' THEN 'PENDING' ELSE 'PROCESSING' END, result, source::text
  FROM "MailJob" WHERE "programId" = ${programId} AND "partNo" = 0 AND (
    "receiptFinishedAt" IS NOT NULL OR (
      "legacySnapshotStatus" IS NULL AND state <> 'QUARANTINED'
    )
  )
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
        source: 'PROGRAM_MANUAL' | 'DEADLINE_MANUAL' | 'DEADLINE_AUTOMATIC';
      }[]
    >`
      SELECT "createdAt", "sentAt", status, result, source FROM (${receiptSources(programId)}) receipts WHERE id = ${jobId}
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
    const groups = await this.prisma.$queryRaw<
      {
        audience: 'STUDENT' | 'STAFF';
        sentCount: number;
        failedCount: number;
        unknownCount: number;
        cancelledCount: number;
        duplicateCount: number;
      }[]
    >`SELECT r.audience, count(*) FILTER (WHERE r.state='SENT')::int AS "sentCount", count(*) FILTER (WHERE r.state='FAILED')::int AS "failedCount",
      count(*) FILTER (WHERE r.state='UNKNOWN')::int AS "unknownCount",count(*) FILTER (WHERE r.state='CANCELLED')::int AS "cancelledCount",count(*) FILTER (WHERE r.state='ALREADY_RESERVED')::int AS "duplicateCount"
      FROM "MailRecipient" r JOIN "MailJob" j ON j.id=r."jobId" WHERE j."receiptId"=${jobId} AND j."programId"=${programId} AND j."legacySnapshotStatus" IS NULL GROUP BY r.audience ORDER BY r.audience LIMIT 2`;
    return {
      ...receipt,
      ...(groups.length || batch.source !== 'PROGRAM_MANUAL'
        ? { audiences: groups, source: batch.source }
        : {}),
      status: 'COMPLETED' as const,
      finishedAt: batch.sentAt.toISOString(),
      ...result,
    };
  }
}
