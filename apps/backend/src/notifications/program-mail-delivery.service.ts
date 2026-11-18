import { Inject, Injectable, Logger } from '@nestjs/common';
import { type MailSender, MAIL_SENDER } from './gmail-mail.client';
import {
  ProgramMailRepository,
  type ProgramMailRepositoryPort,
} from './program-mail.repository';
import { ProgramMailTemplateService } from './program-mail-template.service';

const logger = new Logger('ProgramMailDeliveryService');

type ProgramMailDelivery = {
  readonly programId: string;
  readonly programName: string;
  readonly senderName: string;
  readonly subject: string;
  readonly body: string;
  readonly previewVersion: string;
  readonly recipients: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly notificationEmail: string;
  }[];
};

export type ProgramMailDeliveryResult = {
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

@Injectable()
export class ProgramMailDeliveryService {
  constructor(
    @Inject(ProgramMailRepository)
    private readonly repository: ProgramMailRepositoryPort,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    private readonly template: ProgramMailTemplateService,
  ) {}

  async send(input: ProgramMailDelivery): Promise<ProgramMailDeliveryResult> {
    const outcomes = await Promise.all(
      input.recipients.map(async (recipient) => {
        const idempotencyKey = `program-mail:${input.previewVersion}:${recipient.id}`;
        const payload = {
          programId: input.programId,
          subject: `[oss-hub] ${input.subject}`,
          previewVersion: input.previewVersion,
        };
        if (
          !(await this.repository.claimNotification(
            recipient.id,
            idempotencyKey,
            payload,
          ))
        ) {
          return 'DUPLICATE' as const;
        }
        const mail = this.template.build({
          subject: input.subject,
          body: input.body,
          displayName: recipient.displayName,
          senderName: input.senderName,
          programName: input.programName,
        });
        try {
          await this.mailSender.send({
            to: recipient.notificationEmail,
            subject: mail.subject,
            body: mail.text,
            html: mail.html,
          });
          await this.repository.completeNotification(
            idempotencyKey,
            'SENT',
            payload,
          );
          return 'SENT' as const;
        } catch {
          await this.repository.completeNotification(
            idempotencyKey,
            'FAILED',
            payload,
          );
          logger.error('프로그램 메일 발송 실패');
          return 'FAILED' as const;
        }
      }),
    );
    return {
      sentCount: outcomes.filter((outcome) => outcome === 'SENT').length,
      duplicateCount: outcomes.filter((outcome) => outcome === 'DUPLICATE')
        .length,
      failedCount: outcomes.filter((outcome) => outcome === 'FAILED').length,
    };
  }
}
