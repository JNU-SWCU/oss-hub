import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SequentialRepository } from '../platform/sequential.repository';
import { type MailSender, MAIL_SENDER } from './gmail-mail.client';
import { PROGRAM_MAIL_DELIVERY_BATCH_SIZE } from './program-mail.config';
import type {
  ProgramMailDeliveryResult,
  ProgramMailDeliveryStore,
} from './program-mail-delivery.repository';
import { ProgramMailSendRepository } from './program-mail-send.repository';
import { ProgramMailTemplateService } from './program-mail-template.service';

export type { ProgramMailDeliveryResult };

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

@Injectable()
export class ProgramMailDeliveryService {
  private readonly sequential = new SequentialRepository();

  constructor(
    @Inject(ProgramMailSendRepository)
    private readonly repository: Pick<ProgramMailSendRepository, 'run'>,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    private readonly template: ProgramMailTemplateService,
  ) {}

  send(input: ProgramMailDelivery): Promise<ProgramMailDeliveryResult> {
    return this.repository.run(
      {
        actorId: input.actorId,
        programId: input.programId,
        programName: input.programName,
        recipientIds: input.recipients.map((recipient) => recipient.id),
        subject: input.subject,
        bodyHash: createHash('sha256').update(input.body).digest('hex'),
        bodyLength: input.body.length,
        previewVersion: input.previewVersion,
        occurredAt: input.occurredAt,
      },
      (transaction) => this.deliver(input, transaction),
    );
  }

  private async deliver(
    input: ProgramMailDelivery,
    transaction: ProgramMailDeliveryStore,
  ): Promise<ProgramMailDeliveryResult> {
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
            const idempotencyKey = transaction.key(
              input.previewVersion,
              recipient.id,
            );
            const payload = {
              programId: input.programId,
              subject: `[oss-hub] ${input.subject}`,
              previewVersion: input.previewVersion,
            };
            if (
              !(await transaction.claimNotification(
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
              await transaction.completeNotification(
                idempotencyKey,
                'SENT',
                payload,
              );
              return 'SENT';
            } catch {
              await transaction.completeNotification(
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
    return {
      sentCount: outcomes.filter((outcome) => outcome === 'SENT').length,
      duplicateCount: outcomes.filter((outcome) => outcome === 'DUPLICATE')
        .length,
      failedCount: outcomes.filter((outcome) => outcome === 'FAILED').length,
    };
  }
}
