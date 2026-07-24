import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import type {
  DeadlineDigestRepositoryPort,
  UpcomingMilestone,
} from './deadline-digest.repository';
import { MAIL_SENDER } from './mail-sender.port';
import type { MailSender } from './mail-sender.port';

/** 마감 임박 판정 리드타임(코드 상수, 손쉬운 조정) — 기본 D-1. */
export const DEADLINE_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DeadlineDigestService {
  private readonly logger = new Logger('DeadlineDigestService');

  constructor(
    @Inject(DeadlineDigestRepository)
    private readonly repository: DeadlineDigestRepositoryPort,
    @Inject(MAIL_SENDER)
    private readonly mailSender: MailSender,
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

    const recipients = await this.repository.findStaffRecipients();
    const subject = `[oss-hub] 마감 임박 마일스톤 ${milestones.length}건`;
    const body = this.buildBody(milestones);

    for (const recipient of recipients) {
      try {
        await this.mailSender.send({
          to: recipient.notificationEmail,
          subject,
          body,
        });
        await this.repository.recordNotification(recipient.id, 'SENT', {
          milestoneCount: milestones.length,
        });
        this.logger.log(`마감 알림 발송 성공 userId=${recipient.id}`);
      } catch (error) {
        await this.repository.recordNotification(recipient.id, 'FAILED', {
          milestoneCount: milestones.length,
          error: error instanceof Error ? error.message : 'unknown',
        });
        this.logger.error(`마감 알림 발송 실패 userId=${recipient.id}`);
      }
    }
  }

  private buildBody(milestones: readonly UpcomingMilestone[]): string {
    const lines = milestones.map(
      (milestone) =>
        `- ${milestone.programName} / ${milestone.milestoneName} (마감 ${milestone.dueAt.toISOString()})`,
    );
    return ['마감이 임박한 마일스톤입니다.', '', ...lines].join('\n');
  }
}
