import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import {
  buildStaffDeadlineMail,
  buildStudentDeadlineMail,
  parseFrontendOrigin,
} from './deadline-digest-mail.template';
import type { BuiltDeadlineMail } from './deadline-digest-mail.template';
import { DEADLINE_DIGEST_DELIVERY_FAILURE } from './deadline-digest-failure';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import type {
  DeadlineDigestRepositoryPort,
  MissingSubmitter,
  UpcomingMilestone,
} from './deadline-digest.repository';
import { MAIL_SENDER } from './mail-sender.port';
import type { MailSender } from './mail-sender.port';

export const DEADLINE_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

interface DigestDispatch {
  readonly recipient: {
    readonly id: string;
    readonly notificationEmail: string;
  };
  readonly mail: BuiltDeadlineMail;
  readonly milestoneCount: number;
  readonly now: Date;
}

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
    const milestones = await this.repository.findUpcomingDeadlineMilestones(
      now,
      new Date(now.getTime() + DEADLINE_LEAD_TIME_MS),
    );
    if (milestones.length === 0) {
      this.logger.log('마감 임박 마일스톤 없음 — 발송 생략');
      return;
    }

    const frontendOrigin = parseFrontendOrigin(this.runtimeConfig.FRONTEND_URL);
    const missingByMilestone =
      await this.repository.findMissingSubmitters(milestones);
    const staffMail = buildStaffDeadlineMail({
      milestones: milestones.map((milestone) => ({
        ...milestone,
        missingNicknames: (missingByMilestone.get(milestone.id) ?? []).map(
          (submitter) => this.formatMissingSubmitter(submitter),
        ),
      })),
      now,
      frontendOrigin,
    });

    await Promise.all(
      (await this.repository.findStaffRecipients()).map((recipient) =>
        this.sendAndRecord({
          recipient,
          mail: staffMail,
          milestoneCount: milestones.length,
          now,
        }),
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
        if (
          submitter.accountStatus !== AccountStatus.ACTIVE ||
          !submitter.notifyEnabled ||
          !submitter.notificationEmail
        ) {
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
          const sortedMilestones = [...reminderMilestones].sort(
            (left, right) => left.dueAt.getTime() - right.dueAt.getTime(),
          );
          const first = sortedMilestones[0];
          if (!first) return Promise.resolve();
          return this.sendAndRecord({
            recipient,
            mail: buildStudentDeadlineMail({
              displayName: recipient.nickname,
              milestones: [first, ...sortedMilestones.slice(1)],
              now,
              frontendOrigin,
            }),
            milestoneCount: reminderMilestones.length,
            now,
          });
        },
      ),
    );
  }

  private async sendAndRecord(dispatch: DigestDispatch): Promise<void> {
    const { recipient, mail, milestoneCount, now } = dispatch;
    const idempotencyKey = `deadline-digest:${this.digestDate(now)}:${recipient.id}`;
    const payload = { milestoneCount };
    if (
      !(await this.repository.claimNotification(
        recipient.id,
        idempotencyKey,
        payload,
      ))
    ) {
      this.logger.log('마감 알림 중복 발송 생략');
      return;
    }

    try {
      await this.mailSender.send({
        to: recipient.notificationEmail,
        subject: mail.subject,
        body: mail.text,
        html: mail.html,
      });
      await this.repository.completeNotification(
        idempotencyKey,
        'SENT',
        payload,
      );
      this.logger.log('마감 알림 발송 성공');
    } catch {
      await this.repository.completeNotification(idempotencyKey, 'FAILED', {
        ...payload,
        ...DEADLINE_DIGEST_DELIVERY_FAILURE,
      });
      this.logger.error('마감 알림 발송 실패');
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

  private formatMissingSubmitter(submitter: MissingSubmitter): string {
    return submitter.accountStatus === AccountStatus.DEACTIVATED
      ? `${submitter.nickname} (비활성)`
      : submitter.nickname;
  }
}
