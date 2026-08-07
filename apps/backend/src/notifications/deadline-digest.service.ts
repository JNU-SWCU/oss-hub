import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import {
  buildStaffDeadlineMail,
  buildStudentDeadlineMail,
} from './deadline-digest-mail.template';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import type {
  DeadlineDigestRepositoryPort,
  UpcomingMilestone,
} from './deadline-digest.repository';
import { MAIL_SENDER } from './mail-sender.port';
import type { MailSender } from './mail-sender.port';

export const DEADLINE_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DeadlineDigestService {
  private readonly logger = new Logger('DeadlineDigestService');

  constructor(
    @Inject(DeadlineDigestRepository)
    private readonly repository: DeadlineDigestRepositoryPort,
    @Inject(MAIL_SENDER)
    private readonly mailSender: MailSender,
    @Inject(RUNTIME_CONFIG)
    private readonly runtimeConfig: Pick<RuntimeConfig, 'FRONTEND_URL'>,
  ) {}

  async sendDeadlineDigests(now: Date = new Date()): Promise<void> {
    const windowEnd = new Date(now.getTime() + DEADLINE_LEAD_TIME_MS);
    const milestones = await this.repository.findUpcomingDeadlineMilestones(
      now,
      windowEnd,
    );
    if (milestones.length === 0) {
      this.logger.log('마감 임박 마일스톤 없음 — 발송 생략');
      return;
    }

    const frontendOrigin = this.requireFrontendOrigin();
    const missingByMilestone =
      await this.repository.findMissingSubmitters(milestones);

    const staffMail = buildStaffDeadlineMail({
      milestones: milestones.map((milestone) => ({
        ...milestone,
        missingNicknames: (missingByMilestone.get(milestone.id) ?? []).map(
          (submitter) => submitter.nickname,
        ),
      })),
      now,
      frontendOrigin,
    });

    await Promise.all(
      (await this.repository.findStaffRecipients()).map((recipient) =>
        this.sendAndRecord(
          recipient,
          staffMail.subject,
          staffMail.text,
          staffMail.html,
          milestones.length,
          now,
        ),
      ),
    );

    const reminders = new Map<
      string,
      {
        recipient: {
          id: string;
          notificationEmail: string;
          nickname: string;
        };
        milestones: UpcomingMilestone[];
      }
    >();
    for (const milestone of milestones) {
      for (const submitter of missingByMilestone.get(milestone.id) ?? []) {
        if (!submitter.notifyEnabled || !submitter.notificationEmail) {
          continue;
        }
        const reminder = reminders.get(submitter.id);
        if (reminder) {
          reminder.milestones.push(milestone);
          continue;
        }
        reminders.set(submitter.id, {
          recipient: {
            id: submitter.id,
            notificationEmail: submitter.notificationEmail,
            nickname: submitter.nickname,
          },
          milestones: [milestone],
        });
      }
    }

    await Promise.all(
      [...reminders.values()].map(
        ({ recipient, milestones: reminderMilestones }) => {
          const primary = [...reminderMilestones].sort(
            (left, right) => left.dueAt.getTime() - right.dueAt.getTime(),
          )[0];
          if (!primary) {
            return Promise.resolve();
          }
          const studentMail = buildStudentDeadlineMail({
            displayName: recipient.nickname,
            milestone: primary,
            now,
            frontendOrigin,
          });
          if (reminderMilestones.length > 1) {
            const extra = reminderMilestones
              .slice(1)
              .map((item) => `- ${item.programName} / ${item.milestoneName}`)
              .join('\n');
            const text = `${studentMail.text}\n\n추가 미제출 마일스톤:\n${extra}`;
            return this.sendAndRecord(
              recipient,
              studentMail.subject,
              text,
              studentMail.html,
              reminderMilestones.length,
              now,
            );
          }
          return this.sendAndRecord(
            recipient,
            studentMail.subject,
            studentMail.text,
            studentMail.html,
            reminderMilestones.length,
            now,
          );
        },
      ),
    );
  }

  private requireFrontendOrigin(): string {
    const raw = this.runtimeConfig.FRONTEND_URL?.trim();
    if (!raw) {
      throw new Error('FRONTEND_URL is required to build deadline mail links.');
    }
    return raw.replace(/\/$/, '');
  }

  private async sendAndRecord(
    recipient: { readonly id: string; readonly notificationEmail: string },
    subject: string,
    body: string,
    html: string,
    milestoneCount: number,
    now: Date,
  ): Promise<void> {
    const idempotencyKey = `deadline-digest:${this.digestDate(now)}:${recipient.id}`;
    const payload = { milestoneCount };
    if (
      !(await this.repository.claimNotification(
        recipient.id,
        idempotencyKey,
        payload,
      ))
    ) {
      this.logger.log(`마감 알림 중복 발송 생략 userId=${recipient.id}`);
      return;
    }

    try {
      await this.mailSender.send({
        to: recipient.notificationEmail,
        subject,
        body,
        html,
      });
      await this.repository.completeNotification(
        idempotencyKey,
        'SENT',
        payload,
      );
      this.logger.log(`마감 알림 발송 성공 userId=${recipient.id}`);
    } catch (error) {
      await this.repository.completeNotification(idempotencyKey, 'FAILED', {
        ...payload,
        error: error instanceof Error ? error.message : 'unknown',
      });
      this.logger.error(`마감 알림 발송 실패 userId=${recipient.id}`);
    }
  }

  private digestDate(now: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
}
