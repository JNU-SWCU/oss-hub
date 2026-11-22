import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { ProgramMailBatchPayloadRepository } from './program-mail-batch-payload.repository';
import { ProgramMailStoredResultError } from './program-mail-send-state.error';

const PAGE_SIZE = 10;
const scope = (programId: string) => ({
  type: 'PROGRAM_MAIL_SEND',
  channel: 'INTERNAL',
  payload: { path: ['programId'], equals: programId },
});
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
    const where = scope(programId);
    const anchor =
      before === undefined
        ? null
        : await this.prisma.notification.findUnique({
            where: { id: before, ...where },
            select: { createdAt: true, id: true },
          });
    if (before !== undefined && !anchor) throw notFound();
    const rows = await this.prisma.notification.findMany({
      where: {
        ...where,
        ...(anchor && {
          OR: [
            { createdAt: { lt: anchor.createdAt } },
            { createdAt: anchor.createdAt, id: { lt: anchor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, createdAt: true },
      take: PAGE_SIZE + 1,
    });
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
      SELECT "createdAt", "sentAt", status, payload->'result' AS result
      FROM "Notification"
      WHERE id = ${jobId} AND type = 'PROGRAM_MAIL_SEND' AND channel = 'INTERNAL'
        AND payload->>'programId' = ${programId}
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
