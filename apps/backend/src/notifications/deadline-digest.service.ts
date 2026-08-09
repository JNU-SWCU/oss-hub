import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import type {
  DeadlineDigestRepositoryPort,
  MissingSubmitter,
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

    const missingByMilestone =
      await this.repository.findMissingSubmitters(milestones);
    const subject = `[oss-hub] 마감 임박 마일스톤 ${milestones.length}건`;
    const staffBody = this.buildStaffBody(milestones, missingByMilestone);

    await Promise.all(
      (await this.repository.findStaffRecipients()).map((recipient) =>
        this.sendAndRecord(
          recipient,
          subject,
          staffBody,
          milestones.length,
          now,
        ),
      ),
    );

    const reminders = new Map<
      string,
      {
        recipient: { id: string; notificationEmail: string };
        milestones: UpcomingMilestone[];
      }
    >();
    for (const milestone of milestones) {
      for (const submitter of missingByMilestone.get(milestone.id) ?? []) {
        // 비활성 계정은 로그인이 막혀 제출 자체가 불가능하다 — 제출 독촉을 보내지 않는다.
        // 교직원 요약의 미제출자 집계에는 그대로 남는다(운영상 미제출 건을 놓치지 않기 위해).
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
          },
          milestones: [milestone],
        });
      }
    }

    await Promise.all(
      [...reminders.values()].map(
        ({ recipient, milestones: reminderMilestones }) =>
          this.sendAndRecord(
            recipient,
            '[oss-hub] 마감 임박 제출 리마인더',
            this.buildStudentBody(reminderMilestones),
            reminderMilestones.length,
            now,
          ),
      ),
    );
  }

  private async sendAndRecord(
    recipient: { readonly id: string; readonly notificationEmail: string },
    subject: string,
    body: string,
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

  private buildStaffBody(
    milestones: readonly UpcomingMilestone[],
    missingByMilestone: ReadonlyMap<string, readonly MissingSubmitter[]>,
  ): string {
    const lines = milestones.flatMap((milestone) => [
      `- ${milestone.programName} / ${milestone.milestoneName} (마감 ${this.formatDueAt(milestone.dueAt)})`,
      `  미제출자: ${
        (missingByMilestone.get(milestone.id) ?? [])
          .map((submitter) => this.formatMissingSubmitter(submitter))
          .join(', ') || '없음'
      }`,
    ]);
    return ['마감이 임박한 마일스톤입니다.', '', ...lines].join('\n');
  }

  /**
   * 미제출자는 아무도 명단에서 빼지 않고, 비활성 계정에만 표시를 붙인다.
   * 교직원이 「독촉해도 소용없는 사람」을 명단에서 바로 구분하기 위한 표시다.
   * 라벨은 관리자 접근 화면의 DEACTIVATED 표기(「비활성」)와 같은 말을 쓴다.
   * 리마인더 게이트는 안전을 위해 ACTIVE 가 아니면 모두 막지만, 이 표시는
   * 문구가 곧 뜻이므로 DEACTIVATED 에만 붙인다. 수신 거부(notifyEnabled)는
   * 계정 상태가 아니므로 표시 대상이 아니다.
   */
  private formatMissingSubmitter(submitter: MissingSubmitter): string {
    return submitter.accountStatus === AccountStatus.DEACTIVATED
      ? `${submitter.nickname} (비활성)`
      : submitter.nickname;
  }

  private buildStudentBody(milestones: readonly UpcomingMilestone[]): string {
    const lines = milestones.map(
      (milestone) =>
        `- ${milestone.programName} / ${milestone.milestoneName} (마감 ${this.formatDueAt(milestone.dueAt)})`,
    );
    return ['제출하지 않은 마감 임박 마일스톤입니다.', '', ...lines].join('\n');
  }

  private formatDueAt(dueAt: Date): string {
    const date = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(dueAt);
    return `${date} (Asia/Seoul)`;
  }
}
