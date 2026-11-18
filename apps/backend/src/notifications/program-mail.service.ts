import { createHash } from 'node:crypto';
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
import { ProgramMailDeliveryService } from './program-mail-delivery.service';

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
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
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
    private readonly delivery: ProgramMailDeliveryService,
  ) {}

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
    if (
      !Number.isFinite(previewedAt.getTime()) ||
      previewedAt > now ||
      now.getTime() > previewedAt.getTime() + PREVIEW_TTL_MS
    ) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_PREVIEW_STALE);
    }
    const audience = await this.requireAudience(programId, now);
    const prepared = this.prepare(audience, sender, request, previewedAt);
    if (prepared.previewVersion !== request.previewVersion) {
      this.fail(NotificationsErrorCode.PROGRAM_MAIL_PREVIEW_STALE);
    }

    return {
      ...(await this.delivery.send({
        programId,
        programName: prepared.programName,
        senderName: prepared.senderName,
        subject: prepared.subject,
        body: prepared.body,
        previewVersion: prepared.previewVersion,
        recipients: prepared.recipients,
      })),
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
    const previewVersion = createHash('sha256')
      .update(
        JSON.stringify({
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
        }),
      )
      .digest('hex');
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
