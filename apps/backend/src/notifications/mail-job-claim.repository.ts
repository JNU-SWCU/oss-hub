import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { DomainException } from '../platform/error-code.error';
import { MailJobResultRepository } from './mail-job-result.repository';
export type MailEligibility = {
  prepareJob(
    programId: string,
    now: Date,
    anchor: Date,
    guidance: { studentGuidance: string; staffGuidance: string },
    manual: boolean,
    tx: Prisma.TransactionClient,
  ): Promise<{
    prepared: {
      deliveries: readonly {
        recipientId: string;
        audience: string;
        to: string;
        mail: { subject: string; text: string; html: string };
      }[];
    };
  }>;
};
@Injectable()
export class MailJobClaimRepository {
  constructor(
    private readonly db: PrismaService,
    private readonly results: MailJobResultRepository,
  ) {}
  async recover() {
    await this.db.$transaction(
      async (tx) => {
        const [owner] = await tx.$queryRaw<object[]>`
        SELECT id FROM "MailControl" WHERE id=1 AND mode='JOBS' LIMIT 1 FOR UPDATE
      `;
        if (!owner) throw new Error('Mail recovery requires jobs mode');
        await tx.mailRecipient.updateMany({
          where: { state: 'SENDING', job: { legacySnapshotStatus: null } },
          data: {
            state: 'UNKNOWN',
            reason: 'MAIL_DELIVERY_UNKNOWN',
            finishedAt: new Date(),
            envelope: Prisma.DbNull,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async claim(digest: MailEligibility) {
    return await this.db.$transaction(
      async (tx) => {
        const [enabled] = await tx.$queryRaw<
          object[]
        >`SELECT 1 FROM "MailControl" WHERE id=1 AND mode='JOBS' LIMIT 1 FOR SHARE`;
        if (!enabled) return null;
        const job = await tx.mailJob.findFirst({
          where: {
            legacySnapshotStatus: null,
            partFinishedAt: null,
            state: { in: ['QUEUED', 'IN_PROGRESS'] },
          },
          orderBy: [
            { createdAt: 'asc' },
            { receiptId: 'asc' },
            { partNo: 'asc' },
          ],
        });
        if (!job) return null;
        const now = new Date();
        const row = await tx.mailRecipient.findFirst({
          where: { jobId: job.id, state: 'PENDING' },
          orderBy: { ordinal: 'asc' },
        });
        if (!row) {
          if (
            await tx.mailRecipient.count({
              where: { jobId: job.id, state: 'SENDING' },
            })
          )
            throw new Error('Unreconciled mail handoff');
          await tx.mailJob.update({
            where: { id: job.id },
            data: { state: 'COMPLETED', partFinishedAt: now },
          });
          await this.results.finalize(tx, job.receiptId, now);
          return { mail: null };
        }
        const [program] = await tx.$queryRaw<
          { name: string }[]
        >`SELECT name FROM "Program" WHERE id=${job.programId} AND lifecycle='PUBLISHED' LIMIT 1 FOR SHARE`;
        const frozen = row.envelope;
        if (
          !frozen ||
          typeof frozen !== 'object' ||
          Array.isArray(frozen) ||
          typeof frozen.to !== 'string' ||
          typeof frozen.subject !== 'string' ||
          typeof frozen.body !== 'string' ||
          typeof frozen.html !== 'string'
        )
          throw new Error('Malformed frozen mail');
        const mail = {
          to: frozen.to,
          subject: frozen.subject,
          body: frozen.body,
          html: frozen.html,
        };
        let eligible = false;
        if (program && job.source === 'PROGRAM_MANUAL') {
          const [person] = await tx.$queryRaw<{ name: string }[]>`
          SELECT COALESCE(u.name,u.login) AS name FROM "User" u
          WHERE u.id=${row.userId} AND u."accountStatus"='ACTIVE' AND u."notifyEnabled" AND u."notificationEmail"=${mail.to}
          AND EXISTS (SELECT FROM "Team" t WHERE t."programId"=${job.programId} AND t."archivedAt" IS NULL
            AND (t."applicantId"=u.id OR EXISTS (SELECT FROM "TeamMember" m WHERE m."teamId"=t.id AND m."userId"=u.id))) LIMIT 1 FOR SHARE
        `;
          eligible =
            person?.name === frozen.displayName &&
            program.name === frozen.programName;
        } else if (
          program &&
          typeof frozen.anchor === 'string' &&
          typeof frozen.studentGuidance === 'string' &&
          typeof frozen.staffGuidance === 'string'
        ) {
          try {
            const { prepared } = await digest.prepareJob(
              job.programId,
              now,
              new Date(frozen.anchor),
              {
                studentGuidance: frozen.studentGuidance,
                staffGuidance: frozen.staffGuidance,
              },
              job.source === 'DEADLINE_MANUAL',
              tx,
            );
            eligible = prepared.deliveries.some(
              (d) =>
                d.recipientId === row.userId &&
                d.audience === row.audience &&
                d.to === mail.to &&
                d.mail.subject === mail.subject &&
                d.mail.text === mail.body &&
                d.mail.html === mail.html,
            );
          } catch (error) {
            if (
              !(error instanceof DomainException) ||
              error.errorCode.code !== 'NOT_004'
            )
              throw error;
          }
        }
        await tx.mailJob.update({
          where: { id: job.id },
          data: { state: 'IN_PROGRESS' },
        });
        await tx.mailRecipient.update({
          where: { id: row.id, state: 'PENDING' },
          data: eligible
            ? { state: 'SENDING' }
            : {
                state: 'CANCELLED',
                reason: 'ELIGIBILITY_CHANGED',
                envelope: Prisma.DbNull,
                finishedAt: now,
              },
        });
        return eligible ? { id: row.id, mail } : { mail: null };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async record(id: string, state: 'SENT' | 'FAILED' | 'UNKNOWN') {
    await this.db.mailRecipient.update({
      where: { id: id, state: 'SENDING' },
      data: {
        state,
        reason: state === 'UNKNOWN' ? 'MAIL_DELIVERY_UNKNOWN' : null,
        envelope: Prisma.DbNull,
        finishedAt: new Date(),
      },
    });
  }
}
