import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { DomainException } from '../common/error-code';
import {
  buildDeadlineEligibility,
  deadlineWindow,
  type DeadlineEligibility,
  type DeadlineEligibilitySummary,
} from './deadline-digest-eligibility';
import { dispatchDeadlineDigest } from './deadline-digest-delivery';
import {
  parseFrontendOrigin,
  type BuiltDeadlineMail,
} from './deadline-digest-mail.template';
import {
  prepareDeadlineDigest,
  type DeadlineDigestGuidance,
  type PersonalizedDeadlinePreview,
} from './deadline-digest-preview';
import {
  DeadlineDigestRepository,
  type DeadlineDigestRepositoryPort,
} from './deadline-digest.repository';
import { MAIL_SENDER, type MailSender } from './mail-sender.port';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.enum';

export const DEADLINE_PREVIEW_TTL_MS = 10 * 60 * 1000;

export type DeadlineDigestPreview = DeadlineEligibilitySummary & {
  readonly staffRecipientCount: number;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
  readonly studentPreviews: readonly PersonalizedDeadlinePreview[];
  readonly staffPreview: BuiltDeadlineMail | null;
};

export type DeadlineDigestSendRequest = DeadlineDigestGuidance & {
  readonly previewedAt: string;
  readonly previewVersion: string;
};

export type DeadlineDigestSendResult = DeadlineEligibilitySummary & {
  readonly staffRecipientCount: number;
  readonly sentAt: string;
  readonly previewVersion: string;
  /** Counts remain student-only; staff outcomes remain in the notification ledger. */
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

@Injectable()
export class DeadlineDigestService {
  constructor(
    @Inject(DeadlineDigestRepository)
    private readonly repository: DeadlineDigestRepositoryPort,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    @Inject(RUNTIME_CONFIG)
    private readonly runtimeConfig: Pick<RuntimeConfig, 'FRONTEND_URL'>,
  ) {}

  async previewProgram(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
    guidance: DeadlineDigestGuidance = {},
  ): Promise<DeadlineDigestPreview> {
    await this.requireStaffOrAdmin(githubId);
    const eligibility = await this.requireEligibility(programId, now);
    const staffRecipients =
      eligibility.staffMilestones.length === 0
        ? []
        : await this.repository.findNotifiableStaff();
    const prepared = prepareDeadlineDigest(eligibility, staffRecipients, {
      ...guidance,
      now,
      frontendOrigin: parseFrontendOrigin(this.runtimeConfig.FRONTEND_URL),
    });
    return {
      ...eligibility.summary,
      staffRecipientCount: staffRecipients.length,
      previewedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + DEADLINE_PREVIEW_TTL_MS,
      ).toISOString(),
      previewVersion: prepared.previewVersion,
      studentPreviews: prepared.studentPreviews,
      staffPreview: prepared.staffPreview,
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
    const staffRecipients =
      eligibility.staffMilestones.length === 0
        ? []
        : await this.repository.findNotifiableStaff();
    // Eligibility is current; relative headline wording stays identical to what was confirmed.
    const prepared = prepareDeadlineDigest(eligibility, staffRecipients, {
      ...preview,
      now: previewedAt,
      frontendOrigin: parseFrontendOrigin(this.runtimeConfig.FRONTEND_URL),
    });
    if (prepared.previewVersion !== preview.previewVersion)
      this.fail(NotificationsErrorCode.DEADLINE_PREVIEW_STALE);
    const dependencies = {
      repository: this.repository,
      mailSender: this.mailSender,
    };
    const outcomes = await dispatchDeadlineDigest(
      {
        programId,
        now,
        deliveries: prepared.deliveries.filter(
          (mail) => mail.audience === 'STUDENT',
        ),
      },
      dependencies,
    );
    // The existing manual-only staff summary follows the student batch; cron never calls it.
    await dispatchDeadlineDigest(
      {
        programId,
        now,
        deliveries: prepared.deliveries.filter(
          (mail) => mail.audience === 'STAFF',
        ),
      },
      dependencies,
    );
    return {
      ...eligibility.summary,
      staffRecipientCount: staffRecipients.length,
      sentAt: now.toISOString(),
      previewVersion: prepared.previewVersion,
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
      const prepared = prepareDeadlineDigest(
        buildDeadlineEligibility(source, window),
        [],
        {
          now,
          frontendOrigin: parseFrontendOrigin(this.runtimeConfig.FRONTEND_URL),
        },
      );
      await dispatchDeadlineDigest(
        { programId, now, deliveries: prepared.deliveries },
        {
          repository: this.repository,
          mailSender: this.mailSender,
        },
      );
    }
  }

  private async requireStaffOrAdmin(githubId: bigint): Promise<void> {
    if (!(await this.repository.findActiveStaffOrAdmin(githubId)))
      this.fail(NotificationsErrorCode.STAFF_ONLY);
  }

  private async requireEligibility(
    programId: string,
    now: Date,
  ): Promise<DeadlineEligibility> {
    const source = await this.repository.findDeadlineProgram(programId);
    if (source === null) this.fail(NotificationsErrorCode.PROGRAM_NOT_FOUND);
    if (!source.notifyOnDeadline)
      this.fail(NotificationsErrorCode.DEADLINE_DISABLED);
    return buildDeadlineEligibility(source, deadlineWindow(now));
  }

  private fail(code: NotificationsErrorCode): never {
    throw new DomainException(NOTIFICATIONS_ERROR_CODES[code]);
  }
}
