import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SequentialRepository } from '../platform/sequential.repository';
import { type MailSender, MAIL_SENDER } from './gmail-mail.client';
import {
  ProgramMailRepository,
  type ProgramMailRepositoryPort,
} from './program-mail.repository';
import { PROGRAM_MAIL_DELIVERY_BATCH_SIZE } from './program-mail.config';
import { ProgramMailTemplateService } from './program-mail-template.service';

const logger = new Logger('ProgramMailDeliveryService');

type ProgramMailDelivery = {
  readonly actorId: string;
  readonly programId: string;
  readonly programName: string;
  readonly senderName: string;
  readonly subject: string;
  readonly body: string;
  readonly previewVersion: string;
  readonly occurredAt: Date;
  readonly recipients: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly notificationEmail: string;
  }[];
};

type ProgramMailDeliveryOutcome = 'SENT' | 'DUPLICATE' | 'FAILED';

export type ProgramMailDeliveryResult = {
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

@Injectable()
export class ProgramMailDeliveryService {
  private readonly sequential = new SequentialRepository();

  constructor(
    @Inject(ProgramMailRepository)
    private readonly repository: ProgramMailRepositoryPort,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    private readonly template: ProgramMailTemplateService,
  ) {}

  async send(input: ProgramMailDelivery): Promise<ProgramMailDeliveryResult> {
    const batches = Array.from(
      {
        length: Math.ceil(
          input.recipients.length / PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
        ),
      },
      (_, index) =>
        input.recipients.slice(
          index * PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
          (index + 1) * PROGRAM_MAIL_DELIVERY_BATCH_SIZE,
        ),
    );
    const outcomes: ProgramMailDeliveryOutcome[] = [];
    await this.sequential.forEach(batches, async (batch) => {
      outcomes.push(
        ...(await Promise.all(
          batch.map(async (recipient): Promise<ProgramMailDeliveryOutcome> => {
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
              return 'DUPLICATE';
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
              return 'SENT';
            } catch {
              await this.repository.completeNotification(
                idempotencyKey,
                'FAILED',
                payload,
              );
              logger.error('프로그램 메일 발송 실패');
              return 'FAILED';
            }
          }),
        )),
      );
    });
    const result = {
      sentCount: outcomes.filter((outcome) => outcome === 'SENT').length,
      duplicateCount: outcomes.filter((outcome) => outcome === 'DUPLICATE')
        .length,
      failedCount: outcomes.filter((outcome) => outcome === 'FAILED').length,
    };
    await this.repository.recordSendAudit({
      actorId: input.actorId,
      programId: input.programId,
      programName: input.programName,
      recipientIds: input.recipients.map((recipient) => recipient.id),
      subject: input.subject,
      bodyHash: createHash('sha256').update(input.body).digest('hex'),
      bodyLength: input.body.length,
      idempotencyKey: `program-mail-send:${input.previewVersion}`,
      occurredAt: input.occurredAt,
      ...result,
    });
    return result;
  }
}
