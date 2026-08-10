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
  buildStudentDeadlineMail,
  parseFrontendOrigin,
} from './deadline-digest-mail.template';
import { DeadlineDigestRepository } from './deadline-digest.repository';
import type {
  DeadlineDigestRepositoryPort,
  DigestNotificationStatus,
} from './deadline-digest.repository';
import { MAIL_SENDER } from './mail-sender.port';
import type { MailSender } from './mail-sender.port';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.enum';

export const DEADLINE_PREVIEW_TTL_MS = 10 * 60 * 1000;

export type DeadlineDigestPreview = DeadlineEligibilitySummary & {
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
};

export type DeadlineDigestSendRequest = {
  readonly previewedAt: string;
  readonly previewVersion: string;
};

export type DeadlineDigestSendResult = DeadlineEligibilitySummary & {
  readonly sentAt: string;
  readonly previewVersion: string;
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
    return {
      ...eligibility.summary,
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
    return {
      ...eligibility.summary,
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

  private async sendRecipient(
    programId: string,
    recipient: EligibleDeadlineRecipient,
    now: Date,
    frontendOrigin: URL,
  ): Promise<DeliveryOutcome> {
    const idempotencyKey = `deadline-digest:${digestDate(now)}:${programId}:${recipient.id}`;
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
