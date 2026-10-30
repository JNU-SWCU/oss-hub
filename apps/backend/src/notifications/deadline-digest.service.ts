import { Logger, Inject, Injectable, type Provider } from '@nestjs/common';
import { DEADLINE_DIGEST_DELIVERY_FAILURE } from './deadline-digest-failure.error';
import {
  type PreparedDeadlineMail,
  prepareDeadlineDigest,
  type DeadlineDigestGuidance,
} from './deadline-digest-preview.policy';
import {
  type DeadlineDigestRepositoryPort,
  DeadlineDigestRepository,
} from './deadline-digest.repository';
import {
  type MailSender,
  MAIL_SENDER,
  type DeadlineDigestPreview,
  type DeadlineDigestSendRequest,
  type DeadlineDigestSendResult,
} from './notifications.types';
import type { RuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { DomainException } from '../platform/error-code.error';
import {
  buildDeadlineEligibility,
  deadlineWindow,
  type DeadlineEligibility,
} from './deadline-digest-eligibility.policy';
import { parseFrontendOrigin } from './deadline-digest-mail-template.policy';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  GmailMailSender,
  type GmailSenderConfig,
  LogMailSender,
} from './mail.client';

type DeadlineDeliveryOutcome = 'SENT' | 'DUPLICATE' | 'FAILED';
const logger = new Logger('DeadlineDigestService');

async function dispatchDeadlineDigest(
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

const DEADLINE_PREVIEW_TTL_MS = 10 * 60 * 1000;

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

@Injectable()
export class DeadlineDigestScheduler {
  constructor(
    @Inject(DeadlineDigestService)
    private readonly service: DeadlineDigestService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })
  async run(): Promise<void> {
    await this.service.sendDeadlineDigests();
  }
}

function gmailConfigFromRuntime(
  runtimeConfig: RuntimeConfig,
): GmailSenderConfig | null {
  const values = [
    runtimeConfig.GMAIL_SENDER,
    runtimeConfig.GMAIL_OAUTH_CLIENT_ID,
    runtimeConfig.GMAIL_OAUTH_CLIENT_SECRET,
    runtimeConfig.GMAIL_OAUTH_REFRESH_TOKEN,
  ];
  if (values.some((value) => value?.trim() === '')) {
    return null;
  }
  const [sender, clientId, clientSecret, refreshToken] = values.map((value) =>
    value?.trim(),
  );
  if (!sender || !clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return { sender, clientId, clientSecret, refreshToken };
}

export function isDryRunMailSender(mailSender: MailSender): boolean {
  return mailSender instanceof LogMailSender;
}

export function resolveMailSender(runtimeConfig: RuntimeConfig): MailSender {
  const mode = runtimeConfig.MAIL_MODE;
  if (mode !== 'send' && mode !== 'dry-run') {
    throw new Error(
      `MAIL_MODE must be "send" or "dry-run" (received ${mode === undefined || mode.trim() === '' ? 'missing/blank' : JSON.stringify(mode)}).`,
    );
  }
  if (mode === 'dry-run') return new LogMailSender();
  const config = gmailConfigFromRuntime(runtimeConfig);
  if (!config) {
    throw new Error(
      'MAIL_MODE=send requires GMAIL_SENDER and GMAIL_OAUTH_* credentials.',
    );
  }
  return new GmailMailSender(config);
}

export const mailSenderProvider: Provider = {
  provide: MAIL_SENDER,
  inject: [RUNTIME_CONFIG],
  useFactory: (runtimeConfig: RuntimeConfig) =>
    resolveMailSender(runtimeConfig),
};
