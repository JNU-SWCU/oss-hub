import { FrontendOriginError } from './deadline-digest-failure.error';
import { Logger, Inject, Injectable, type Provider } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { isEmail } from 'class-validator';
import {
  DEADLINE_DIGEST_DELIVERY_FAILURE,
  InvalidDigestForceToError,
} from './deadline-digest-failure.error';
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
import {
  GmailMailClient,
  type GmailSenderConfig,
  LogMailClient,
  type MailSender,
  MAIL_SENDER,
} from './gmail-mail.client';
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

export function deadlineWindow(now: Date): DeadlineWindow {
  return {
    from: new Date(now),
    to: new Date(now.getTime() + DEADLINE_LEAD_TIME_MS),
  };
}

export function buildDeadlineEligibility(
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

export interface DeadlineMailMilestone {
  readonly id: string;
  readonly programId: string;
  readonly programName: string;
  readonly milestoneName: string;
  readonly dueAt: Date;
}

export interface BuiltDeadlineMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function parseFrontendOrigin(value: string | undefined): URL {
  const trimmed = value?.trim();
  if (!trimmed || !URL.canParse(trimmed)) throw new FrontendOriginError();
  const url = new URL(trimmed);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new FrontendOriginError();
  }
  return url;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDueAt(dueAt: Date): string {
  const formatted = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(dueAt);
  return `${formatted} (Asia/Seoul)`;
}

function deadlineHeadline(dueAt: Date, now: Date): string {
  const remainingHours = (dueAt.getTime() - now.getTime()) / 3_600_000;
  if (remainingHours <= 1) return '제출 마감 1시간 전';
  if (remainingHours <= 3) return '제출 마감 3시간 전';
  if (remainingHours <= 6) return '제출 마감 6시간 전';
  if (remainingHours <= 12) return '제출 마감 12시간 전';
  return '제출 마감 24시간 전';
}

function routeUrl(origin: URL, path: string): string {
  return new URL(path, origin).toString();
}

function renderHtml(input: {
  readonly title: string;
  readonly greeting: string;
  readonly lead: string;
  readonly guidance?: string;
  readonly items: readonly {
    readonly rows: readonly {
      readonly label: string;
      readonly value: string;
    }[];
    readonly ctaLabel: string;
    readonly ctaUrl: string;
  }[];
}): string {
  const items = input.items
    .map(
      (item) =>
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;">${item.rows
          .map(
            ({ label, value }) =>
              `<tr><th align="left" style="padding:8px;color:#475569;font-size:14px;overflow-wrap:normal;">${escapeHtml(label)}</th><td style="padding:8px;color:#0f172a;font-size:14px;">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}</table>
<p style="margin:0 0 20px;text-align:center;"><a href="${escapeHtml(item.ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#003399;color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(item.ctaLabel)}</a></p>
<p style="margin:-12px 0 20px;color:#64748b;font-size:12px;word-break:break-all;">${escapeHtml(item.ctaUrl)}</p>`,
    )
    .join('');
  const title = escapeHtml(input.title);
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,'Noto Sans KR',sans-serif;word-break:keep-all;overflow-wrap:anywhere;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f8fafc;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px;background:#003399;color:#ffffff;"><h1 style="margin:0;font-size:22px;">${title}</h1></td></tr>
<tr><td style="padding:24px;"><p style="margin:0 0 12px;font-size:16px;">${escapeHtml(input.greeting)}</p>
<p style="margin:0 0 20px;line-height:1.6;">${escapeHtml(input.lead)}</p>
${input.guidance ? `<p style="margin:0 0 20px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(input.guidance)}</p>` : ''}
${items}</td></tr>
</table></td></tr></table></body></html>`;
}

export function buildStudentDeadlineMail(input: {
  readonly displayName: string;
  readonly milestones: readonly [
    DeadlineMailMilestone,
    ...DeadlineMailMilestone[],
  ];
  readonly now: Date;
  readonly frontendOrigin: URL;
  readonly guidance?: string;
}): BuiltDeadlineMail {
  const first = input.milestones[0];
  const title =
    input.milestones.length === 1
      ? `${deadlineHeadline(first.dueAt, input.now)} · ${first.milestoneName}`
      : `마감 임박 제출 ${input.milestones.length}건`;
  const lead = `제출 마감이 임박한 마일스톤이 ${input.milestones.length}건 있습니다.`;
  const items = input.milestones.map((milestone) => {
    const ctaUrl = routeUrl(
      input.frontendOrigin,
      `/programs/${encodeURIComponent(milestone.programId)}#milestone-${encodeURIComponent(milestone.id)}-name`,
    );
    return {
      rows: [
        { label: '프로그램', value: milestone.programName },
        { label: '마일스톤', value: milestone.milestoneName },
        { label: '마감일시', value: formatDueAt(milestone.dueAt) },
      ],
      ctaLabel: '제출하러 가기',
      ctaUrl,
    } as const;
  });
  const text = [
    `안녕하세요, ${input.displayName}님.`,
    '',
    lead,
    '',
    ...(input.guidance ? [input.guidance, ''] : []),
    ...items.flatMap((item) => [
      ...item.rows.map(({ label, value }) => `${label}: ${value}`),
      `제출하러 가기: ${item.ctaUrl}`,
      '',
    ]),
  ].join('\n');
  return {
    subject: `[oss-hub] ${title}`,
    text,
    html: renderHtml({
      title,
      greeting: `안녕하세요, ${input.displayName}님.`,
      lead,
      guidance: input.guidance,
      items,
    }),
  };
}

export function buildStaffDeadlineMail(input: {
  readonly milestones: readonly (DeadlineMailMilestone & {
    readonly missingNicknames: readonly string[];
  })[];
  readonly now: Date;
  readonly frontendOrigin: URL;
  readonly guidance?: string;
}): BuiltDeadlineMail {
  const first = input.milestones[0];
  const title =
    input.milestones.length === 1 && first
      ? `${deadlineHeadline(first.dueAt, input.now)} · ${first.milestoneName}`
      : `마감 임박 마일스톤 ${input.milestones.length}건`;
  const ctaUrl = routeUrl(input.frontendOrigin, '/dashboard');
  const rows = input.milestones.flatMap((milestone) => [
    {
      label: '프로그램 / 마일스톤',
      value: `${milestone.programName} / ${milestone.milestoneName}`,
    },
    { label: '마감일시', value: formatDueAt(milestone.dueAt) },
    {
      label: '미제출자',
      value: milestone.missingNicknames.join(', ') || '없음',
    },
  ]);
  const lead = `마감이 임박한 마일스톤이 ${input.milestones.length}건 있습니다.`;
  const text = [
    '안녕하세요, 운영진님.',
    '',
    lead,
    '',
    ...(input.guidance ? [input.guidance, ''] : []),
    ...rows.map(({ label, value }) => `${label}: ${value}`),
    '',
    `대시보드 열기: ${ctaUrl}`,
  ].join('\n');
  return {
    subject: `[oss-hub] ${title}`,
    text,
    html: renderHtml({
      title,
      greeting: '안녕하세요, 운영진님.',
      lead,
      guidance: input.guidance,
      items: [{ rows, ctaLabel: '대시보드 열기', ctaUrl }],
    }),
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

export function prepareDeadlineDigest(
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
    const mail = buildStudentDeadlineMail({
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
      ? buildStaffDeadlineMail({
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
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'Asia/Seoul' })
  async run(): Promise<void> {
    await this.sendDeadlineDigests();
  }

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

function isDryRunMailSender(mailSender: MailSender): boolean {
  return mailSender instanceof LogMailClient;
}

export function resolveMailSender(runtimeConfig: RuntimeConfig): MailSender {
  const mode = runtimeConfig.MAIL_MODE;
  if (mode !== 'send' && mode !== 'dry-run') {
    throw new Error(
      `MAIL_MODE must be "send" or "dry-run" (received ${mode === undefined || mode.trim() === '' ? 'missing/blank' : JSON.stringify(mode)}).`,
    );
  }
  if (mode === 'dry-run') return new LogMailClient();
  const config = gmailConfigFromRuntime(runtimeConfig);
  if (!config) {
    throw new Error(
      'MAIL_MODE=send requires GMAIL_SENDER and GMAIL_OAUTH_* credentials.',
    );
  }
  return new GmailMailClient(config);
}

export const mailSenderProvider: Provider = {
  provide: MAIL_SENDER,
  inject: [RUNTIME_CONFIG],
  useFactory: (runtimeConfig: RuntimeConfig) =>
    resolveMailSender(runtimeConfig),
};

function parseDigestForceTo(value: string): string {
  const trimmed = value.trim();
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    value.includes(',') ||
    value.includes(';') ||
    hasControlCharacter ||
    !isEmail(trimmed)
  ) {
    throw new InvalidDigestForceToError();
  }
  return trimmed;
}

export async function sendForcedDeadlineDigest(
  runtime: RuntimeConfig,
  forceToValue: string,
  logger: Logger,
): Promise<void> {
  const forceTo = parseDigestForceTo(forceToValue);
  const mailer = resolveMailSender(runtime);
  const usingGmail = !isDryRunMailSender(mailer);
  if (!usingGmail) {
    logger.warn(
      'MAIL_MODE=dry-run — dry-run 로그만 남깁니다. 실수신을 원하면 MAIL_MODE=send 와 GMAIL_* 4종을 채우세요.',
    );
  }
  const now = new Date();
  const mail = buildStudentDeadlineMail({
    displayName: '합성 로컬 스모크 수신자',
    milestones: [
      {
        id: 'synthetic-local-smoke-milestone',
        programId: 'synthetic-local-smoke-program',
        programName: '합성 로컬 점검 프로그램',
        milestoneName: '강제 발송 스모크 마일스톤',
        dueAt: new Date(now.getTime() + 3_600_000),
      },
    ],
    now,
    frontendOrigin: parseFrontendOrigin(runtime.FRONTEND_URL),
  });
  await mailer.send({
    to: forceTo,
    subject: mail.subject,
    body: mail.text,
    html: mail.html,
  });
  logger.log(
    usingGmail
      ? '강제 실발송 완료 (수신 주소는 로그에 전체 노출하지 않음)'
      : '강제 dry-run 완료',
  );
}
