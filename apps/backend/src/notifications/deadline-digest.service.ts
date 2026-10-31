import {
  type BuiltDeadlineMail,
  DeadlineDigestMailService,
} from './deadline-digest-mail.service';
import { Logger, Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DEADLINE_DIGEST_DELIVERY_FAILURE } from './deadline-digest-failure.error';
import {
  type DeadlineDigestRepositoryPort,
  DeadlineDigestRepository,
  DeadlineRecipientSource,
  DeadlineWindow,
  DeadlineProgramSource,
  type NotifiableStaffRecipient,
} from './deadline-digest.repository';
import type { RuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { DomainException } from '../platform/error-code.error';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import { type MailSender, MAIL_SENDER } from './gmail-mail.client';
import { AccountStatus } from '@prisma/client';
import { createHash } from 'node:crypto';

const DEADLINE_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

type EligibleDeadlineMilestone = {
  readonly id: string;
  readonly programId: string;
  readonly programName: string;
  readonly milestoneName: string;
  readonly dueAt: Date;
  readonly missingDocumentIds: readonly string[];
};

type EligibleDeadlineRecipient = {
  readonly id: string;
  readonly nickname: string;
  readonly notificationEmail: string;
  readonly milestones: readonly EligibleDeadlineMilestone[];
};

type StaffDeadlineMilestone = EligibleDeadlineMilestone & {
  readonly missingNicknames: readonly string[];
};

type DeadlineEligibilitySummary = {
  readonly applicationCount: number;
  readonly milestoneCount: number;
  readonly recipientCount: number;
  readonly inactiveCount: number;
  readonly optedOutCount: number;
  readonly noEmailCount: number;
};

export type DeadlineEligibility = {
  readonly programId: string;
  readonly enabled: boolean;
  readonly milestones: readonly EligibleDeadlineMilestone[];
  readonly recipients: readonly EligibleDeadlineRecipient[];
  readonly staffMilestones: readonly StaffDeadlineMilestone[];
  readonly applicationCount: number;
  readonly summary: DeadlineEligibilitySummary;
  readonly previewVersion: string;
};

type RecipientAccumulator = {
  readonly source: DeadlineRecipientSource;
  readonly milestones: Map<string, EligibleDeadlineMilestone>;
};

type ExclusionReason = 'inactive' | 'optedOut' | 'noEmail';

const EXCLUSION_SUFFIXES: Record<ExclusionReason, string> = {
  inactive: '비활성',
  optedOut: '수신 거부',
  noEmail: '이메일 없음',
};

type CandidateClassification =
  | { readonly excluded: ExclusionReason }
  | { readonly excluded: null; readonly notificationEmail: string };

function classifyCandidate(
  source: DeadlineRecipientSource,
): CandidateClassification {
  if (source.accountStatus !== AccountStatus.ACTIVE) {
    return { excluded: 'inactive' };
  }
  if (!source.notifyEnabled) return { excluded: 'optedOut' };
  if (source.notificationEmail === null) return { excluded: 'noEmail' };
  return { excluded: null, notificationEmail: source.notificationEmail };
}

function missingNickname(
  source: DeadlineRecipientSource,
  excluded: ExclusionReason | null,
): string {
  return excluded === null
    ? source.nickname
    : `${source.nickname} (${EXCLUSION_SUFFIXES[excluded]})`;
}

function compareMilestones(
  left: EligibleDeadlineMilestone,
  right: EligibleDeadlineMilestone,
): number {
  return (
    left.dueAt.getTime() - right.dueAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function canonicalMilestone(milestone: EligibleDeadlineMilestone) {
  return {
    id: milestone.id,
    dueAt: milestone.dueAt.toISOString(),
    missingDocumentIds: [...milestone.missingDocumentIds].sort(),
  };
}

export interface DeadlineDigestGuidance {
  readonly studentGuidance?: string;
  readonly staffGuidance?: string;
}

export interface PreparedDeadlineMail {
  readonly audience: 'STUDENT' | 'STAFF';
  readonly recipientId: string;
  readonly to: string;
  readonly milestoneCount: number;
  readonly mail: BuiltDeadlineMail;
}

export interface PersonalizedDeadlinePreview extends BuiltDeadlineMail {
  readonly displayName: string;
}

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
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

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
    private readonly mail: DeadlineDigestMailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })
  async run(): Promise<void> {
    await this.sendDeadlineDigests();
  }

  previewProgramFromRequest(
    programId: string,
    guidance: DeadlineDigestGuidance,
  ): Promise<DeadlineDigestPreview> {
    return this.previewProgram(programId, new Date(), guidance);
  }

  async previewProgram(
    programId: string,
    now: Date = new Date(),
    guidance: DeadlineDigestGuidance = {},
  ): Promise<DeadlineDigestPreview> {
    const eligibility = await this.requireEligibility(programId, now);
    const staffRecipients =
      eligibility.staffMilestones.length === 0
        ? []
        : await this.repository.findNotifiableStaff();
    const prepared = this.prepareDeadlineDigest(eligibility, staffRecipients, {
      ...guidance,
      now,
      frontendOrigin: this.mail.parseFrontendOrigin(
        this.runtimeConfig.FRONTEND_URL,
      ),
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
    programId: string,
    preview: DeadlineDigestSendRequest,
    now: Date = new Date(),
  ): Promise<DeadlineDigestSendResult> {
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

    const prepared = this.prepareDeadlineDigest(eligibility, staffRecipients, {
      ...preview,
      now: previewedAt,
      frontendOrigin: this.mail.parseFrontendOrigin(
        this.runtimeConfig.FRONTEND_URL,
      ),
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
    const window = this.deadlineWindow(now);
    const programIds = await this.repository.findAutomaticProgramIds(window);
    for (const programId of programIds) {
      const source = await this.repository.findDeadlineProgram(programId);
      if (source === null || !source.notifyOnDeadline) continue;
      const prepared = this.prepareDeadlineDigest(
        this.buildDeadlineEligibility(source, window),
        [],
        {
          now,
          frontendOrigin: this.mail.parseFrontendOrigin(
            this.runtimeConfig.FRONTEND_URL,
          ),
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

  private async requireEligibility(
    programId: string,
    now: Date,
  ): Promise<DeadlineEligibility> {
    const source = await this.repository.findDeadlineProgram(programId);
    if (source === null) this.fail(NotificationsErrorCode.PROGRAM_NOT_FOUND);
    if (!source.notifyOnDeadline)
      this.fail(NotificationsErrorCode.DEADLINE_DISABLED);
    return this.buildDeadlineEligibility(source, this.deadlineWindow(now));
  }

  private fail(code: NotificationsErrorCode): never {
    throw new DomainException(NOTIFICATIONS_ERROR_CODES[code]);
  }

  deadlineWindow(now: Date): DeadlineWindow {
    return {
      from: new Date(now),
      to: new Date(now.getTime() + DEADLINE_LEAD_TIME_MS),
    };
  }

  buildDeadlineEligibility(
    source: DeadlineProgramSource,
    window: DeadlineWindow,
  ): DeadlineEligibility {
    const milestones = source.milestones
      .flatMap((milestone) => {
        const requiredDocumentIds = milestone.documents
          .filter((document) => document.required)
          .map((document) => document.id)
          .sort();
        return milestone.dueAt >= window.from &&
          milestone.dueAt <= window.to &&
          requiredDocumentIds.length > 0
          ? [
              {
                id: milestone.id,
                programId: source.id,
                programName: source.name,
                milestoneName: milestone.name,
                dueAt: milestone.dueAt,
                missingDocumentIds: requiredDocumentIds,
              },
            ]
          : [];
      })
      .sort(compareMilestones);
    const recipients = new Map<string, RecipientAccumulator>();
    const eligibleApplicationIds: string[] = [];

    for (const application of source.applications) {
      const submitted = new Set(application.submittedDocumentIds);
      const missingMilestones = milestones.flatMap((milestone) => {
        const missingDocumentIds = milestone.missingDocumentIds.filter(
          (documentId) => !submitted.has(documentId),
        );
        return missingDocumentIds.length === 0
          ? []
          : [{ ...milestone, missingDocumentIds }];
      });
      if (missingMilestones.length === 0) continue;
      eligibleApplicationIds.push(application.id);

      const applicationRecipients = new Map(
        [application.applicant, ...application.members].map((recipient) => [
          recipient.id,
          recipient,
        ]),
      );
      for (const recipient of applicationRecipients.values()) {
        const current = recipients.get(recipient.id) ?? {
          source: recipient,
          milestones: new Map<string, EligibleDeadlineMilestone>(),
        };
        for (const milestone of missingMilestones) {
          const existing = current.milestones.get(milestone.id);
          current.milestones.set(
            milestone.id,
            existing === undefined
              ? milestone
              : {
                  ...milestone,
                  missingDocumentIds: [
                    ...new Set([
                      ...existing.missingDocumentIds,
                      ...milestone.missingDocumentIds,
                    ]),
                  ].sort(),
                },
          );
        }
        recipients.set(recipient.id, current);
      }
    }

    const orderedCandidates = [...recipients.values()].sort((left, right) =>
      left.source.id.localeCompare(right.source.id),
    );
    const counts = { inactive: 0, optedOut: 0, noEmail: 0 };
    const deliverableRecipients: EligibleDeadlineRecipient[] = [];
    const missingNicknames = new Map<string, string[]>();
    for (const candidate of orderedCandidates) {
      const classification = classifyCandidate(candidate.source);
      const label = missingNickname(candidate.source, classification.excluded);

      for (const milestoneId of candidate.milestones.keys()) {
        missingNicknames.set(milestoneId, [
          ...(missingNicknames.get(milestoneId) ?? []),
          label,
        ]);
      }
      if (classification.excluded !== null) {
        counts[classification.excluded] += 1;
        continue;
      }
      deliverableRecipients.push({
        id: candidate.source.id,
        nickname: candidate.source.nickname,
        notificationEmail: classification.notificationEmail,
        milestones: [...candidate.milestones.values()].sort(compareMilestones),
      });
    }
    const staffMilestones = milestones.flatMap((milestone) => {
      const missing = missingNicknames.get(milestone.id) ?? [];
      return missing.length === 0
        ? []
        : [{ ...milestone, missingNicknames: missing }];
    });

    const summary = {
      applicationCount: eligibleApplicationIds.length,
      milestoneCount: milestones.length,
      recipientCount: deliverableRecipients.length,
      inactiveCount: counts.inactive,
      optedOutCount: counts.optedOut,
      noEmailCount: counts.noEmail,
    };

    const canonical = {
      programId: source.id,
      enabled: source.notifyOnDeadline,
      milestones: milestones.map(canonicalMilestone),
      applicationIds: eligibleApplicationIds.sort(),
      candidates: orderedCandidates.map((candidate) => ({
        id: candidate.source.id,
        accountStatus: candidate.source.accountStatus,
        notifyEnabled: candidate.source.notifyEnabled,
        notificationEmail: candidate.source.notificationEmail,
        milestones: [...candidate.milestones.values()]
          .sort(compareMilestones)
          .map(canonicalMilestone),
      })),
    };
    return {
      programId: source.id,
      enabled: source.notifyOnDeadline,
      milestones,
      recipients: deliverableRecipients,
      staffMilestones,
      applicationCount: eligibleApplicationIds.length,
      summary,
      previewVersion: createHash('sha256')
        .update(JSON.stringify(canonical))
        .digest('hex'),
    };
  }

  prepareDeadlineDigest(
    eligibility: DeadlineEligibility,
    staffRecipients: readonly NotifiableStaffRecipient[],
    draft: DeadlineDigestGuidance & {
      readonly now: Date;
      readonly frontendOrigin: URL;
    },
  ): {
    readonly deliveries: readonly PreparedDeadlineMail[];
    readonly studentPreviews: readonly PersonalizedDeadlinePreview[];
    readonly staffPreview: BuiltDeadlineMail | null;
    readonly previewVersion: string;
  } {
    const students = eligibility.recipients.flatMap((recipient) => {
      const first = recipient.milestones[0];
      if (first === undefined) return [];
      const mail = this.mail.buildStudentDeadlineMail({
        displayName: recipient.nickname,
        milestones: [first, ...recipient.milestones.slice(1)],
        now: draft.now,
        frontendOrigin: draft.frontendOrigin,
        guidance: draft.studentGuidance,
      });
      return [{ recipient, mail }];
    });
    const staffPreview =
      staffRecipients.length > 0 && eligibility.staffMilestones.length > 0
        ? this.mail.buildStaffDeadlineMail({
            milestones: eligibility.staffMilestones,
            now: draft.now,
            frontendOrigin: draft.frontendOrigin,
            guidance: draft.staffGuidance,
          })
        : null;
    const deliveries: readonly PreparedDeadlineMail[] = [
      ...students.map(({ recipient, mail }) => ({
        audience: 'STUDENT' as const,
        recipientId: recipient.id,
        to: recipient.notificationEmail,
        milestoneCount: recipient.milestones.length,
        mail,
      })),
      ...(staffPreview === null
        ? []
        : staffRecipients.map((recipient) => ({
            audience: 'STAFF' as const,
            recipientId: recipient.id,
            to: recipient.notificationEmail,
            milestoneCount: eligibility.staffMilestones.length,
            mail: staffPreview,
          }))),
    ];
    const previewVersion = createHash('sha256')
      .update(
        JSON.stringify({
          eligibility: eligibility.previewVersion,
          previewedAt: draft.now.toISOString(),
          studentGuidance: draft.studentGuidance ?? '',
          staffGuidance: draft.staffGuidance ?? '',
          deliveries,
        }),
      )
      .digest('hex');
    return {
      deliveries,
      studentPreviews: students.map(({ recipient, mail }) => ({
        displayName: recipient.nickname,
        ...mail,
      })),
      staffPreview,
      previewVersion,
    };
  }
}
