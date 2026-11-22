import { MailPreviewService } from './mail-preview.service';
import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import type { ActiveAccountPrincipal } from '../auth/http-auth.types';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import {
  ProgramMailRepository,
  type ProgramMailApplicant,
  type ProgramMailAudience,
  type ProgramMailRepositoryPort,
} from './program-mail.repository';
import { PROGRAM_MAIL_RECIPIENT_LIMIT } from './program-mail.config';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import { ProgramMailJobRepository } from './program-mail-job.repository';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const DEADLINE_LEAD_TIME_MS = 24 * 60 * 60 * 1000;
const FOOTER = '이 메일은 oss-hub에서 발송했습니다.';

type ProgramMailDraft = {
  readonly subject: string;
  readonly body: string;
  readonly applicantIds: readonly string[];
};

export type ProgramMailRecipients = {
  readonly programId: string;
  readonly programName: string;
  readonly teams: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    readonly deadlineEligible: boolean;
    readonly applicants: readonly {
      readonly id: string;
      readonly displayName: string;
      readonly nickname: string;
      readonly mailAvailable: boolean;
    }[];
  }[];
};

export type ProgramMailPreview = ProgramMailDraft & {
  readonly programName: string;
  readonly senderName: string;
  readonly recipientNames: readonly string[];
  readonly recipientCount: number;
  readonly renderedSubject: string;
  readonly footer: string;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
};

export type ProgramMailSendRequest = ProgramMailDraft & {
  readonly previewedAt: string;
  readonly previewVersion: string;
};

export type ProgramMailSendResult = {
  readonly jobId: string;
  readonly status: 'IN_PROGRESS' | 'COMPLETED';
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
  readonly unknownCount?: number;
  readonly previewVersion: string;
};

type DeliverableProgramMailApplicant = ProgramMailApplicant & {
  readonly notificationEmail: string;
};

type PreparedProgramMail = ProgramMailPreview & {
  readonly recipients: readonly DeliverableProgramMailApplicant[];
};

@Injectable()
export class ProgramMailService {
  constructor(
    @Inject(ProgramMailRepository)
    private readonly repository: ProgramMailRepositoryPort,
    @Inject(ProgramMailDeliveryService)
    private readonly delivery: Pick<ProgramMailDeliveryService, 'send'>,
    @Inject(ProgramMailJobRepository)
    private readonly jobs: Pick<ProgramMailJobRepository, 'recent' | 'status'>,
    private readonly previews: MailPreviewService,
  ) {}

  recent(programId: string, before?: string) {
    return this.jobs.recent(programId, before);
  }

  status(programId: string, jobId: string) {
    return this.jobs.status(programId, jobId);
  }

  async recipients(
    programId: string,
    now = new Date(),
  ): Promise<ProgramMailRecipients> {
    const audience = await this.requireAudience(programId, now);
    return {
      programId: audience.id,
      programName: audience.name,
      teams: audience.teams.map((team) => ({
        id: team.id,
        name: team.name,
        status: team.status,
        deadlineEligible: team.deadlineEligible,
        applicants: team.applicants.map((applicant) => ({
          id: applicant.id,
          displayName: applicant.displayName,
          nickname: applicant.nickname,
          mailAvailable: applicant.mailAvailable,
        })),
      })),
    };
  }

  async preview(
    programId: string,
    sender: ActiveAccountPrincipal,
    draft: ProgramMailDraft,
    now = new Date(),
  ): Promise<ProgramMailPreview> {
    const audience = await this.requireAudience(programId, now);
    const prepared = this.prepare(audience, sender, draft, now);
    const { recipients, ...preview } = prepared;
    void recipients;
    return preview;
  }

  async send(
    programId: string,
    sender: ActiveAccountPrincipal,
    request: ProgramMailSendRequest,
    now = new Date(),
  ): Promise<ProgramMailSendResult> {
    const previewedAt = new Date(request.previewedAt);
    if (!this.previews.legacyIsCurrent(previewedAt, now, PREVIEW_TTL_MS)) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_PREVIEW_STALE);
    }
    const audience = await this.requireAudience(programId, now);
    const prepared = this.prepare(audience, sender, request, previewedAt);
    if (prepared.previewVersion !== request.previewVersion) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_PREVIEW_STALE);
    }
    const delivery = await this.delivery.send({
      actorId: sender.id,
      programId,
      programName: prepared.programName,
      senderName: prepared.senderName,
      subject: prepared.subject,
      body: prepared.body,
      previewVersion: prepared.previewVersion,
      occurredAt: now,
      recipients: prepared.recipients,
    });
    return {
      status: delivery.kind,
      jobId: delivery.jobId,
      ...(delivery.kind === 'COMPLETED'
        ? delivery.result
        : {
            sentCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            unknownCount: 0,
          }),
      previewVersion: prepared.previewVersion,
    };
  }

  private async requireAudience(
    programId: string,
    now: Date,
  ): Promise<ProgramMailAudience> {
    const audience = await this.repository.findAudience(programId, {
      from: now,
      to: new Date(now.getTime() + DEADLINE_LEAD_TIME_MS),
    });
    if (audience === null) this.fail(NotificationsErrorCode.PROGRAM_NOT_FOUND);
    return audience;
  }

  private prepare(
    audience: ProgramMailAudience,
    sender: ActiveAccountPrincipal,
    draft: ProgramMailDraft,
    previewedAt: Date,
  ): PreparedProgramMail {
    const subject = draft.subject.trim();
    const body = draft.body.trim();
    const selectedIds = [...new Set(draft.applicantIds)].sort();
    const applicantById = new Map(
      audience.teams.flatMap((team) =>
        team.applicants.map((applicant) => [applicant.id, applicant] as const),
      ),
    );
    if (selectedIds.length > PROGRAM_MAIL_RECIPIENT_LIMIT) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_RECIPIENT_LIMIT);
    }
    const recipients = selectedIds.flatMap((id) => {
      const applicant = applicantById.get(id);
      return applicant?.mailAvailable && applicant.notificationEmail !== null
        ? [{ ...applicant, notificationEmail: applicant.notificationEmail }]
        : [];
    });
    if (subject.length === 0 || body.length === 0) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_CONTENT_INVALID);
    }
    if (recipients.length !== selectedIds.length) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_RECIPIENT_INVALID);
    }
    const senderName = sender.name ?? sender.nickname;
    const renderedSubject = `[oss-hub] ${subject}`;
    const previewVersion = this.previews.version({
      programId: audience.id,
      programName: audience.name,
      senderId: sender.id,
      senderName,
      subject,
      body,
      previewedAt: previewedAt.toISOString(),
      recipients: recipients.map((recipient) => ({
        id: recipient.id,
        notificationEmail: recipient.notificationEmail,
      })),
    });
    return {
      subject,
      body,
      applicantIds: selectedIds,
      programName: audience.name,
      senderName,
      recipientNames: recipients.map((recipient) => recipient.displayName),
      recipientCount: recipients.length,
      renderedSubject,
      footer: FOOTER,
      previewedAt: previewedAt.toISOString(),
      expiresAt: new Date(previewedAt.getTime() + PREVIEW_TTL_MS).toISOString(),
      previewVersion,
      recipients,
    };
  }

  private fail(code: NotificationsErrorCode): never {
    throw new DomainException(NOTIFICATIONS_ERROR_CODES[code]);
  }
}
