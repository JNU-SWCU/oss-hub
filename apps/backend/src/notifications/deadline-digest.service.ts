import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { DomainException } from '../common/error-code';
import {
  buildDeadlineEligibility,
  deadlineWindow,
  type DeadlineEligibility,
  type DeadlineEligibilitySummary,
  type EligibleDeadlineRecipient,
} from './deadline-digest-eligibility';
import { DEADLINE_DIGEST_DELIVERY_FAILURE } from './deadline-digest-failure';
import {
  buildStaffDeadlineMail,
  buildStudentDeadlineMail,
  parseFrontendOrigin,
} from './deadline-digest-mail.template';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import type {
  DeadlineDigestRepositoryPort,
  DigestNotificationStatus,
  NotifiableStaffRecipient,
} from './deadline-digest.repository';
import { MAIL_SENDER } from './mail-sender.port';
import type { MailSender } from './mail-sender.port';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.enum';

export const DEADLINE_PREVIEW_TTL_MS = 10 * 60 * 1000;

/**
 * 학생 리마인더 멱등 키 접두어. 형식을 바꾸면 같은 날 이미 받은 학생에게 한 통 더 나간다.
 */
const STUDENT_DIGEST_KEY_PREFIX = 'deadline-digest';
/**
 * 교직원 요약 멱등 키 접두어. 학생과 반드시 달라야 한다 — STAFF 계정이 같은 프로그램의
 * 팀원을 겸하면 접두어가 같을 때 한쪽이 조용히 DUPLICATE로 삼켜진다.
 */
const STAFF_DIGEST_KEY_PREFIX = 'deadline-digest-staff';

export type DeadlineDigestPreview = DeadlineEligibilitySummary & {
  /**
   * 교직원 요약을 받을 사람 수. `recipientCount`(학생 기준)에 합산하지 않는다 —
   * `optedOutCount`/`inactiveCount`/`noEmailCount`가 모두 학생 후보 기준 집계라
   * 합치면 세 값과 뜻이 어긋난다.
   */
  readonly staffRecipientCount: number;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
};

export type DeadlineDigestSendRequest = {
  readonly previewedAt: string;
  readonly previewVersion: string;
};

export type DeadlineDigestSendResult = DeadlineEligibilitySummary & {
  readonly staffRecipientCount: number;
  readonly sentAt: string;
  readonly previewVersion: string;
  /** 아래 세 집계는 학생 발송 기준이다. 교직원 발송 결과는 알림 원장에만 남는다. */
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

type DeliveryOutcome = 'SENT' | 'DUPLICATE' | 'FAILED';

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

  async previewProgram(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<DeadlineDigestPreview> {
    await this.requireStaffOrAdmin(githubId);
    const eligibility = await this.requireEligibility(programId, now);
    const staffRecipients = await this.resolveStaffRecipients(eligibility);
    return {
      ...eligibility.summary,
      staffRecipientCount: staffRecipients.length,
      previewedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + DEADLINE_PREVIEW_TTL_MS,
      ).toISOString(),
      previewVersion: eligibility.previewVersion,
    };
  }

  async sendProgramFromPreview(
    githubId: bigint,
    programId: string,
    preview: DeadlineDigestSendRequest,
    now: Date = new Date(),
  ): Promise<DeadlineDigestSendResult> {
    await this.requireStaffOrAdmin(githubId);
    const previewedAt = new Date(preview.previewedAt);
    if (
      !Number.isFinite(previewedAt.getTime()) ||
      previewedAt > now ||
      now.getTime() > previewedAt.getTime() + DEADLINE_PREVIEW_TTL_MS
    ) {
      this.fail(NotificationsErrorCode.DEADLINE_PREVIEW_STALE);
    }
    const eligibility = await this.requireEligibility(programId, now);
    if (eligibility.previewVersion !== preview.previewVersion) {
      this.fail(NotificationsErrorCode.DEADLINE_PREVIEW_STALE);
    }
    const outcomes = await this.dispatch(eligibility, now);
    // 교직원 요약은 수동 발송에서만 나간다. 09시 cron(`sendDeadlineDigests`)은 붙이지 않는다.
    const staffRecipients = await this.resolveStaffRecipients(eligibility);
    await this.dispatchStaff(eligibility, staffRecipients, now);
    return {
      ...eligibility.summary,
      staffRecipientCount: staffRecipients.length,
      sentAt: now.toISOString(),
      previewVersion: eligibility.previewVersion,
      sentCount: outcomes.filter((outcome) => outcome === 'SENT').length,
      duplicateCount: outcomes.filter((outcome) => outcome === 'DUPLICATE')
        .length,
      failedCount: outcomes.filter((outcome) => outcome === 'FAILED').length,
    };
  }

  async sendDeadlineDigests(now: Date = new Date()): Promise<void> {
    const window = deadlineWindow(now);
    const programIds = await this.repository.findAutomaticProgramIds(window);
    for (const programId of programIds) {
      const source = await this.repository.findDeadlineProgram(programId);
      if (source === null || !source.notifyOnDeadline) continue;
      await this.dispatch(buildDeadlineEligibility(source, window), now);
    }
  }

  private async requireStaffOrAdmin(githubId: bigint): Promise<void> {
    if (!(await this.repository.findActiveStaffOrAdmin(githubId))) {
      this.fail(NotificationsErrorCode.STAFF_ONLY);
    }
  }

  private async requireEligibility(
    programId: string,
    now: Date,
  ): Promise<DeadlineEligibility> {
    const source = await this.repository.findDeadlineProgram(programId);
    if (source === null) this.fail(NotificationsErrorCode.PROGRAM_NOT_FOUND);
    if (!source.notifyOnDeadline) {
      this.fail(NotificationsErrorCode.DEADLINE_DISABLED);
    }
    return buildDeadlineEligibility(source, deadlineWindow(now));
  }

  private dispatch(
    eligibility: DeadlineEligibility,
    now: Date,
  ): Promise<readonly DeliveryOutcome[]> {
    const frontendOrigin = parseFrontendOrigin(this.runtimeConfig.FRONTEND_URL);
    return Promise.all(
      eligibility.recipients.map((recipient) =>
        this.sendRecipient(
          eligibility.programId,
          recipient,
          now,
          frontendOrigin,
        ),
      ),
    );
  }

  private async resolveStaffRecipients(
    eligibility: DeadlineEligibility,
  ): Promise<readonly NotifiableStaffRecipient[]> {
    if (eligibility.staffMilestones.length === 0) return [];
    return this.repository.findNotifiableStaff();
  }

  private async dispatchStaff(
    eligibility: DeadlineEligibility,
    staffRecipients: readonly NotifiableStaffRecipient[],
    now: Date,
  ): Promise<void> {
    if (staffRecipients.length === 0) return;
    const frontendOrigin = parseFrontendOrigin(this.runtimeConfig.FRONTEND_URL);
    await Promise.all(
      staffRecipients.map((recipient) =>
        this.sendStaffRecipient(eligibility, recipient, now, frontendOrigin),
      ),
    );
  }

  private async sendStaffRecipient(
    eligibility: DeadlineEligibility,
    recipient: NotifiableStaffRecipient,
    now: Date,
    frontendOrigin: URL,
  ): Promise<void> {
    const idempotencyKey = `${STAFF_DIGEST_KEY_PREFIX}:${digestDate(now)}:${eligibility.programId}:${recipient.id}`;
    const payload = { milestoneCount: eligibility.staffMilestones.length };
    if (
      !(await this.repository.claimNotification(
        recipient.id,
        idempotencyKey,
        payload,
      ))
    ) {
      return;
    }
    const mail = buildStaffDeadlineMail({
      milestones: eligibility.staffMilestones,
      now,
      frontendOrigin,
    });
    try {
      await this.mailSender.send({
        to: recipient.notificationEmail,
        subject: mail.subject,
        body: mail.text,
        html: mail.html,
      });
      await this.complete(idempotencyKey, 'SENT', payload);
    } catch {
      await this.complete(idempotencyKey, 'FAILED', {
        ...payload,
        ...DEADLINE_DIGEST_DELIVERY_FAILURE,
      });
      this.logger.error('교직원 마감 요약 발송 실패');
    }
  }

  private async sendRecipient(
    programId: string,
    recipient: EligibleDeadlineRecipient,
    now: Date,
    frontendOrigin: URL,
  ): Promise<DeliveryOutcome> {
    const idempotencyKey = `${STUDENT_DIGEST_KEY_PREFIX}:${digestDate(now)}:${programId}:${recipient.id}`;
    const payload = { milestoneCount: recipient.milestones.length };
    if (
      !(await this.repository.claimNotification(
        recipient.id,
        idempotencyKey,
        payload,
      ))
    ) {
      return 'DUPLICATE';
    }
    const firstMilestone = recipient.milestones[0];
    if (firstMilestone === undefined) return 'DUPLICATE';
    const mail = buildStudentDeadlineMail({
      displayName: recipient.nickname,
      milestones: [firstMilestone, ...recipient.milestones.slice(1)],
      now,
      frontendOrigin,
    });
    try {
      await this.mailSender.send({
        to: recipient.notificationEmail,
        subject: mail.subject,
        body: mail.text,
        html: mail.html,
      });
      await this.complete(idempotencyKey, 'SENT', payload);
      return 'SENT';
    } catch {
      await this.complete(idempotencyKey, 'FAILED', {
        ...payload,
        ...DEADLINE_DIGEST_DELIVERY_FAILURE,
      });
      this.logger.error('마감 알림 발송 실패');
      return 'FAILED';
    }
  }

  private complete(
    idempotencyKey: string,
    status: DigestNotificationStatus,
    payload: Record<string, string | number>,
  ): Promise<void> {
    return this.repository.completeNotification(
      idempotencyKey,
      status,
      payload,
    );
  }

  private fail(code: NotificationsErrorCode): never {
    throw new DomainException(NOTIFICATIONS_ERROR_CODES[code]);
  }
}

function digestDate(now: Date): string {
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
