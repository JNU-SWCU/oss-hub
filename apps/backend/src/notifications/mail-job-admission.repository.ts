import { SequentialRepository } from '../platform/sequential.repository';
import { MailJobConfig } from './mail-job.config';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MailAudience, MailSource, Prisma } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { PrismaService } from '../platform/prisma.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';

export type JobDelivery = {
  readonly audience: MailAudience;
  readonly userId: string;
  readonly envelope: Prisma.InputJsonObject;
};

export type MailIntent = {
  readonly source: MailSource;
  readonly programId: string;
  readonly actorId: string | null;
  readonly previewVersion: string;
  readonly requestDigest: string;
};

export type MailTransaction = Prisma.TransactionClient;
@Injectable()
export class MailJobAdmissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async accept(
    intent: MailIntent,
    prepare: (
      tx: Prisma.TransactionClient,
      now: Date,
    ) => Promise<{
      readonly deliveries: readonly JobDelivery[];
      readonly summary?: Readonly<Record<string, number>>;
    }>,
  ) {
    const reserve = () =>
      this.prisma.$transaction(
        async (tx) => {
          const [control] = await tx.$queryRaw<{ mode: string }[]>`
        SELECT mode FROM "MailControl" WHERE id = 1 LIMIT 1 FOR UPDATE
      `;
          const [clock] = await tx.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now LIMIT 1`;
          if (!clock) throw new Error('Database clock unavailable');
          const { now } = clock;
          const day = MailJobConfig.seoulDay(now);
          const automatic = intent.source === 'DEADLINE_AUTOMATIC';
          const prefix = [intent.source, intent.programId, intent.actorId];
          const automaticDeliveries = automatic ? await prepare(tx, now) : null;
          const intentKey = MailJobConfig.digest(
            automatic
              ? [
                  ...prefix,
                  day,
                  automaticDeliveries?.deliveries
                    .map((row) => [row.audience, row.userId])
                    .sort((a, b) =>
                      JSON.stringify(a).localeCompare(JSON.stringify(b)),
                    ),
                ]
              : [...prefix, intent.previewVersion],
          );
          const prior = await tx.mailJob.findUnique({
            where: { intentKey },
            select: { receiptId: true, requestDigest: true },
          });
          if (prior) {
            if (!automatic && prior.requestDigest !== intent.requestDigest)
              throw new DomainException(
                NOTIFICATIONS_ERROR_CODES[
                  NotificationsErrorCode.PROGRAM_MAIL_PREVIEW_STALE
                ],
              );
            return { jobId: prior.receiptId, replay: true };
          }
          if (control?.mode !== 'JOBS')
            throw new DomainException(
              NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.MAIL_PAUSED],
            );
          const { deliveries, summary } =
            automaticDeliveries ?? (await prepare(tx, now));
          if (!automatic) {
            const window = {
              partNo: 0,
              createdAt: { gt: new Date(now.getTime() - 600_000) },
              source: { not: MailSource.DEADLINE_AUTOMATIC },
            };
            const actor = await tx.mailJob.count({
              where: { ...window, actorId: intent.actorId },
            });
            const program = await tx.mailJob.count({
              where: { ...window, programId: intent.programId },
            });
            if (actor >= 3 || program >= 5)
              throw new DomainException(
                NOTIFICATIONS_ERROR_CODES[
                  NotificationsErrorCode.PROGRAM_MAIL_RATE_LIMITED
                ],
              );
          }
          if (automatic && deliveries.length === 0) return null;
          const receiptId = randomUUID();
          const ordered = [...deliveries].sort(
            (a, b) =>
              a.audience.localeCompare(b.audience) ||
              a.userId.localeCompare(b.userId),
          );
          await new SequentialRepository().repeat(
            Math.max(1, Math.ceil(ordered.length / 200)),
            async (partNo) => {
              const offset = partNo * 200;
              const id = offset === 0 ? receiptId : randomUUID();
              await tx.mailJob.create({
                data: {
                  id,
                  receiptId,
                  partNo: offset / 200,
                  source: intent.source,
                  programId: intent.programId,
                  actorId: intent.actorId,
                  intentKey: offset === 0 ? intentKey : null,
                  previewVersion: intent.previewVersion,
                  requestDigest: intent.requestDigest,
                  seoulDay: new Date(day),
                  createdAt: now,
                  state: 'QUEUED',
                },
              });
              const part = ordered.slice(offset, offset + 200);
              const keys = part.map(({ audience, userId }) =>
                intent.source === 'PROGRAM_MANUAL'
                  ? `program-mail:${intent.previewVersion}:${userId}`
                  : `${audience === 'STAFF' ? 'deadline-digest-staff' : 'deadline-digest'}:${day}:${intent.programId}:${userId}`,
              );
              if (!part.length) return;
              const old = await tx.notification.findMany({
                where: { idempotencyKey: { in: keys } },
                select: { idempotencyKey: true },
                take: 200,
              });
              const typed = await tx.mailRecipient.findMany({
                where: { deliveryKey: { in: keys } },
                select: { deliveryKey: true },
                take: 200,
              });
              const claimed = new Set([
                ...old.map((r) => r.idempotencyKey),
                ...typed.map((r) => r.deliveryKey),
              ]);
              await tx.mailRecipient.createMany({
                data: part.map((row, ordinal) => {
                  const key = keys[ordinal];
                  if (!key) throw new Error('Missing mail delivery key');
                  const skip = claimed.has(key);
                  return {
                    jobId: id,
                    userId: row.userId,
                    audience: row.audience,
                    ordinal,
                    state: skip ? 'ALREADY_RESERVED' : 'PENDING',
                    deliveryKey: skip ? null : key,
                    envelope: skip ? Prisma.DbNull : row.envelope,
                    createdAt: now,
                    finishedAt: skip ? now : null,
                  };
                }),
              });
            },
          );
          await tx.programHistory.create({
            data: {
              programId: intent.programId,
              actorId: intent.actorId,
              occurredAt: now,
              event: 'MAIL_ACCEPTED',
              source: 'APPLICATION',
              sourceTable: 'MailJob',
              sourceId: `${receiptId}:attempt`,
              data: {
                schemaVersion: 1,
                requestId: receiptId,
                action: 'PROGRAM_MAIL_SEND_ATTEMPTED',
                metadata: {
                  source: intent.source,
                  previewVersion: intent.previewVersion,
                  actorType: automatic ? 'SYSTEM' : 'USER',
                  recipientCount: deliveries.length,
                  ...(summary ? { summary } : {}),
                },
              },
            },
          });
          return { jobId: receiptId, replay: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    const outcome: { value?: Awaited<ReturnType<typeof reserve>> } = {};
    await new SequentialRepository().repeat(4, async (attempt) => {
      try {
        outcome.value = await reserve();
        return 'stop';
      } catch (error) {
        if (
          attempt >= 3 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2034', 'P2002'].includes(error.code)
        )
          throw error;
      }
    });
    if (outcome.value === undefined)
      throw new Error('Mail admission incomplete');
    return outcome.value;
  }
}
