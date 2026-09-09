import { Logger } from '@nestjs/common';
import { DEADLINE_DIGEST_DELIVERY_FAILURE } from './deadline-digest-failure';
import type { PreparedDeadlineMail } from './deadline-digest-preview';
import type { DeadlineDigestRepositoryPort } from './deadline-digest.repository';
import type { MailSender } from './mail-sender.port';

export type DeadlineDeliveryOutcome = 'SENT' | 'DUPLICATE' | 'FAILED';
const logger = new Logger('DeadlineDigestService');

/** Preview and delivery share the same built mail; delivery alone owns claims and ledger results. */
export async function dispatchDeadlineDigest(
  batch: {
    readonly programId: string;
    readonly now: Date;
    readonly deliveries: readonly PreparedDeadlineMail[];
  },
  dependencies: {
    readonly repository: DeadlineDigestRepositoryPort;
    readonly mailSender: MailSender;
  },
): Promise<readonly DeadlineDeliveryOutcome[]> {
  const digestDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(batch.now);
  return Promise.all(
    batch.deliveries.map(async (delivery): Promise<DeadlineDeliveryOutcome> => {
      // Existing prefixes isolate student/staff roles but share automatic/manual daily claims.
      const prefix =
        delivery.audience === 'STUDENT'
          ? 'deadline-digest'
          : 'deadline-digest-staff';
      const idempotencyKey = `${prefix}:${digestDate}:${batch.programId}:${delivery.recipientId}`;
      const payload = { milestoneCount: delivery.milestoneCount };
      if (
        !(await dependencies.repository.claimNotification(
          delivery.recipientId,
          idempotencyKey,
          payload,
        ))
      )
        return 'DUPLICATE';
      // no-excuse-ok: catch — external mail/ledger boundary preserves durable sanitized failure behavior.
      try {
        await dependencies.mailSender.send({
          to: delivery.to,
          subject: delivery.mail.subject,
          body: delivery.mail.text,
          html: delivery.mail.html,
        });
        await dependencies.repository.completeNotification(
          idempotencyKey,
          'SENT',
          payload,
        );
        return 'SENT';
      } catch {
        await dependencies.repository.completeNotification(
          idempotencyKey,
          'FAILED',
          { ...payload, ...DEADLINE_DIGEST_DELIVERY_FAILURE },
        );
        logger.error(
          delivery.audience === 'STUDENT'
            ? '마감 알림 발송 실패'
            : '교직원 마감 요약 발송 실패',
        );
        return 'FAILED';
      }
    }),
  );
}
