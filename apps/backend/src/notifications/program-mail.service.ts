import { MailJobConfig } from './mail-job.config';
import { MailPreviewService } from './mail-preview.service';
import type { MailTransaction } from './mail-job-admission.repository';
import { MailJobAdmissionRepository } from './mail-job-admission.repository';
import { ProgramMailTemplateService } from './program-mail-template.service';
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
    @Inject(MailJobAdmissionRepository)
    private readonly admission: Pick<MailJobAdmissionRepository, 'accept'>,
    @Inject(ProgramMailJobRepository)
    private readonly jobs: Pick<ProgramMailJobRepository, 'recent' | 'status'>,
    private readonly previews: MailPreviewService,
    private readonly templates: ProgramMailTemplateService,
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
  ): Promise<ProgramMailSendResult> {
    const jobId = await this.accept(programId, sender, request, true);
    const status = await this.jobs.status(programId, jobId);
    return {
      jobId,
      status: status.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
      ...(status.status === 'COMPLETED'
        ? {
            sentCount: status.sentCount,
            duplicateCount: status.duplicateCount,
            failedCount: status.failedCount,
            unknownCount: status.unknownCount,
          }
        : { sentCount: 0, duplicateCount: 0, failedCount: 0, unknownCount: 0 }),
      previewVersion: request.previewVersion,
    };
  }

  async accept(
    programId: string,
    sender: ActiveAccountPrincipal,
    request: ProgramMailSendRequest,
    legacy = false,
  ) {
    const accepted = await this.admission.accept(
      {
        programId,
        actorId: sender.id,
        source: 'PROGRAM_MANUAL',
        previewVersion: request.previewVersion,
        requestDigest: MailJobConfig.digest([
          request.previewedAt,
          request.subject.trim(),
          request.body.trim(),
          [...new Set(request.applicantIds)].sort(),
        ]),
      },
      async (tx, now) => {
        const anchor = new Date(request.previewedAt);
        if (
          !this.previews.legacyIsCurrent(anchor, now, PREVIEW_TTL_MS) ||
          (!legacy && now.getTime() >= anchor.getTime() + PREVIEW_TTL_MS)
        )
          this.fail(NotificationsErrorCode.PROGRAM_MAIL_PREVIEW_STALE);
        const prepared = this.prepare(
          await this.requireAudience(programId, now, tx),
          sender,
          request,
          anchor,
        );
        if (prepared.previewVersion !== request.previewVersion)
          this.fail(NotificationsErrorCode.PROGRAM_MAIL_PREVIEW_STALE);
        return {
          deliveries: prepared.recipients.map((recipient) => {
            const { subject, text, html } = this.templates.build({
              ...prepared,
              displayName: recipient.displayName,
            });
            return {
              userId: recipient.id,
              audience: 'STUDENT',
              envelope: {
                to: recipient.notificationEmail,
                subject,
                body: text,
                html,
                displayName: recipient.displayName,
                programName: prepared.programName,
              },
            };
          }),
        };
      },
    );
    if (!accepted)
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_RECIPIENT_INVALID);
    return accepted.jobId;
  }

  private async requireAudience(
    programId: string,
    now: Date,
    tx?: MailTransaction,
  ): Promise<ProgramMailAudience> {
    const audience = await this.repository.findAudience(
      programId,
      {
        from: now,
        to: new Date(now.getTime() + DEADLINE_LEAD_TIME_MS),
      },
      tx,
    );
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
    if (subject.length === 0 || /[\r\n]/.test(subject) || body.length === 0) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_CONTENT_INVALID);
    }
    if (recipients.length === 0 || recipients.length !== selectedIds.length) {
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
        rendered: MailJobConfig.digest(
          this.templates.build({
            subject,
            body,
            displayName: recipient.displayName,
            senderName,
            programName: audience.name,
          }),
        ),
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
