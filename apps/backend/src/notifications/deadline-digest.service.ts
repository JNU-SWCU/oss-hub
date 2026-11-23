import type {
  DeadlineEligibilitySummary,
  DeadlineDigestSendResult,
} from './mail-job.types';
export type { DeadlineDigestSendResult } from './mail-job.types';
import { MailJobConfig } from './mail-job.config';
import { SequentialRepository } from '../platform/sequential.repository';
import {
  type BuiltDeadlineMail,
  DeadlineDigestMailService,
} from './deadline-digest-mail.service';
import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import { MailJobAdmissionRepository } from './mail-job-admission.repository';
import { MailJobResultRepository } from './mail-job-result.repository';
import { AccountStatus } from '@prisma/client';
import type { MailTransaction } from './mail-job-admission.repository';
import { MailPreviewService } from './mail-preview.service';

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

const DEADLINE_PREVIEW_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class DeadlineDigestService {
  private readonly sequential = new SequentialRepository();

  constructor(
    @Inject(DeadlineDigestRepository)
    private readonly repository: DeadlineDigestRepositoryPort,
    @Inject(MailJobAdmissionRepository)
    private readonly admission: Pick<MailJobAdmissionRepository, 'accept'>,
    @Inject(RUNTIME_CONFIG)
    private readonly runtimeConfig: Pick<RuntimeConfig, 'FRONTEND_URL'>,
    private readonly mail: DeadlineDigestMailService,
    private readonly previews: MailPreviewService,
    @Inject(MailJobResultRepository)
    private readonly results: Pick<MailJobResultRepository, 'legacyDigest'>,
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
    actorId: string,
  ): Promise<DeadlineDigestSendResult> {
    const accepted = await this.accept(programId, preview, actorId, true);
    return this.results.legacyDigest(
      programId,
      accepted.jobId,
      accepted.replay,
      preview.previewVersion,
    );
  }

  async accept(
    programId: string,
    preview: DeadlineDigestSendRequest,
    actorId: string,
    legacy = false,
  ) {
    const accepted = await this.admission.accept(
      {
        source: 'DEADLINE_MANUAL',
        programId,
        actorId,
        previewVersion: preview.previewVersion,
        requestDigest: MailJobConfig.digest([
          preview.previewedAt,
          preview.studentGuidance ?? '',
          preview.staffGuidance ?? '',
        ]),
      },
      async (tx, now) => {
        const anchor = new Date(preview.previewedAt);
        if (
          !this.previews.legacyIsCurrent(
            anchor,
            now,
            DEADLINE_PREVIEW_TTL_MS,
          ) ||
          (!legacy &&
            now.getTime() >= anchor.getTime() + DEADLINE_PREVIEW_TTL_MS) ||
          MailJobConfig.seoulDay(anchor) !== MailJobConfig.seoulDay(now)
        )
          this.fail(NotificationsErrorCode.DEADLINE_PREVIEW_STALE);
        const { prepared, eligibility, staff } = await this.prepareJob(
          programId,
          now,
          anchor,
          preview,
          true,
          tx,
        );
        if (
          (legacy
            ? prepared.previewVersion
            : MailJobConfig.digest([
                'deadline-v1',
                programId,
                actorId,
                prepared.previewVersion,
              ])) !== preview.previewVersion
        )
          this.fail(NotificationsErrorCode.DEADLINE_PREVIEW_STALE);
        return {
          deliveries: this.rows(prepared, preview, anchor),
          summary: {
            ...eligibility.summary,
            staffRecipientCount: staff.length,
          },
        };
      },
    );
    if (!accepted) this.fail(NotificationsErrorCode.DEADLINE_PREVIEW_STALE);
    return accepted;
  }

  private rows(
    prepared: ReturnType<DeadlineDigestService['prepareDeadlineDigest']>,
    guidance: DeadlineDigestGuidance,
    anchor: Date,
  ) {
    return prepared.deliveries.map((row) => ({
      userId: row.recipientId,
      audience: row.audience,
      envelope: {
        to: row.to,
        subject: row.mail.subject,
        body: row.mail.text,
        html: row.mail.html,
        studentGuidance: guidance.studentGuidance ?? '',
        staffGuidance: guidance.staffGuidance ?? '',
        anchor: anchor.toISOString(),
      },
    }));
  }

  async prepareJob(
    programId: string,
    now: Date,
    anchor: Date,
    guidance: DeadlineDigestGuidance,
    manual: boolean,
    tx: MailTransaction,
  ) {
    const eligibility = await this.requireEligibility(programId, now, tx);
    const staff =
      manual && eligibility.staffMilestones.length
        ? await this.repository.findNotifiableStaff(tx)
        : [];
    const prepared = this.prepareDeadlineDigest(eligibility, staff, {
      ...guidance,
      now: anchor,
      frontendOrigin: this.mail.parseFrontendOrigin(
        this.runtimeConfig.FRONTEND_URL,
      ),
    });
    return { prepared, eligibility, staff };
  }

  async sendDeadlineDigests(now = new Date()): Promise<void> {
    const ids = await this.repository.findAutomaticProgramIds(
      this.deadlineWindow(now),
    );
    await this.sequential.forEach(ids, async (programId) => {
      await this.admission.accept(
        {
          source: 'DEADLINE_AUTOMATIC',
          programId,
          actorId: null,
          previewVersion: '',
          requestDigest: '',
        },
        async (tx, acceptedAt) => {
          const { prepared } = await this.prepareJob(
            programId,
            acceptedAt,
            acceptedAt,
            {},
            false,
            tx,
          );
          return { deliveries: this.rows(prepared, {}, acceptedAt) };
        },
      );
    });
  }

  private async requireEligibility(
    programId: string,
    now: Date,
    tx?: MailTransaction,
  ): Promise<DeadlineEligibility> {
    const source = await this.repository.findDeadlineProgram(programId, tx);
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
        const requiredDocumentIds = milestone.requirements
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

    for (const application of source.teams) {
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
      teamIds: eligibleApplicationIds.sort(),
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
      previewVersion: this.previews.version(canonical),
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
    const previewVersion = this.previews.version({
      eligibility: eligibility.previewVersion,
      previewedAt: draft.now.toISOString(),
      studentGuidance: draft.studentGuidance ?? '',
      staffGuidance: draft.staffGuidance ?? '',
      deliveries,
    });
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
