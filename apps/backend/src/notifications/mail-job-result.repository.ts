import { SequentialRepository } from '../platform/sequential.repository';
import { setTimeout as delay } from 'node:timers/promises';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  type MailAudience,
  type MailRecipientState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import type { DeadlineDigestSendResult } from './mail-job.types';

const empty = () => ({
  sentCount: 0,
  failedCount: 0,
  unknownCount: 0,
  duplicateCount: 0,
  cancelledCount: 0,
});
const buckets = {
  SENT: 'sentCount',
  FAILED: 'failedCount',
  UNKNOWN: 'unknownCount',
  ALREADY_RESERVED: 'duplicateCount',
  CANCELLED: 'cancelledCount',
} as const;

@Injectable()
export class MailJobResultRepository {
  constructor(private readonly prisma: PrismaService) {}

  async finalize(tx: Prisma.TransactionClient, receiptId: string, now: Date) {
    const root = await tx.mailJob.findUniqueOrThrow({
      where: { id: receiptId },
    });
    if (root.receiptFinishedAt || root.legacySnapshotStatus !== null) return;
    const rows = await tx.$queryRaw<
      { audience: MailAudience; state: MailRecipientState; count: number }[]
    >`
      SELECT r.audience, r.state, count(*)::int AS count FROM "MailRecipient" r
      JOIN "MailJob" j ON j.id = r."jobId" WHERE j."receiptId" = ${receiptId}
      GROUP BY r.audience, r.state LIMIT 14
    `;
    const audiences = { STUDENT: empty(), STAFF: empty() };
    const counts = empty();
    let total = 0;
    for (const row of rows) {
      if (row.state === 'PENDING' || row.state === 'SENDING') return;
      counts[buckets[row.state]] += row.count;
      audiences[row.audience][buckets[row.state]] += row.count;
      total += row.count;
    }
    const attempt = await tx.programHistory.findUniqueOrThrow({
      where: {
        sourceTable_sourceId: {
          sourceTable: 'MailJob',
          sourceId: `${receiptId}:attempt`,
        },
      },
    });
    const data = attempt.data;
    const metadata =
      data && typeof data === 'object' && !Array.isArray(data)
        ? data.metadata
        : null;
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      total !== metadata.recipientCount
    )
      throw new Error('Mail receipt cardinality disagrees with acceptance');
    const result = { ...counts, audiences };
    await tx.mailJob.updateMany({
      where: { receiptId, partFinishedAt: null },
      data: { state: 'COMPLETED', partFinishedAt: now },
    });
    await tx.mailJob.update({
      where: { id: receiptId },
      data: { result, receiptFinishedAt: now },
    });
    const action = counts.failedCount
      ? counts.failedCount === total
        ? 'PROGRAM_MAIL_FAILED'
        : 'PROGRAM_MAIL_PARTIALLY_FAILED'
      : counts.unknownCount
        ? 'PROGRAM_MAIL_DELIVERY_UNKNOWN'
        : 'PROGRAM_MAIL_SENT';
    await tx.programHistory.create({
      data: {
        programId: root.programId,
        actorId: root.actorId,
        event: 'MAIL_COMPLETED',
        source: 'APPLICATION',
        sourceTable: 'MailJob',
        sourceId: `${receiptId}:result`,
        occurredAt: now,
        data: {
          schemaVersion: 1,
          requestId: receiptId,
          action,
          metadata: {
            source: root.source,
            previewVersion: root.previewVersion,
            actorType: root.actorId ? 'USER' : 'SYSTEM',
            ...result,
          },
        },
      },
    });
  }

  async legacyDigest(
    programId: string,
    receiptId: string,
    replay: boolean,
    previewVersion: string,
  ): Promise<DeadlineDigestSendResult> {
    const end = Date.now() + 8000;
    const outcome: { value?: DeadlineDigestSendResult } = {};
    await new SequentialRepository().repeat(32, async () => {
      const [row] = await this.prisma.$queryRaw<
        Omit<DeadlineDigestSendResult, 'previewVersion'>[]
      >`
        SELECT summary.*, students."sentCount", students."duplicateCount", students."failedCount"
        FROM "MailJob" j JOIN "ProgramHistory" a ON a."sourceTable"='MailJob' AND a."sourceId"=j.id||':attempt'
        CROSS JOIN LATERAL jsonb_to_record(a.data#>'{metadata,summary}') AS summary("applicationCount" int, "milestoneCount" int,
          "recipientCount" int, "inactiveCount" int, "optedOutCount" int, "noEmailCount" int, "staffRecipientCount" int)
        CROSS JOIN LATERAL jsonb_to_record(j.result->'audiences'->'STUDENT') AS students("sentCount" int, "duplicateCount" int, "failedCount" int)
        WHERE j.id=${receiptId} AND j."programId"=${programId} AND j."receiptFinishedAt" IS NOT NULL
          AND (j.result->>'unknownCount')::int=0 AND (j.result->>'cancelledCount')::int=0 LIMIT 1
      `;
      if (row) {
        outcome.value = {
          ...row,
          ...(replay
            ? {
                sentCount: 0,
                failedCount: 0,
                duplicateCount: row.recipientCount,
              }
            : {}),
          previewVersion,
        };
        return 'stop';
      }
      if (Date.now() >= end) return 'stop';
      await delay(250);
    });
    if (outcome.value) return outcome.value;
    throw new ServiceUnavailableException({
      message: '발송 기록에서 결과를 확인하세요.',
      jobId: receiptId,
    });
  }
}
