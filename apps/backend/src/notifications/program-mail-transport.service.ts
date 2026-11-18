import { Inject, Injectable } from '@nestjs/common';
import { type MailSender, MAIL_SENDER } from './gmail-mail.client';
import { PROGRAM_MAIL_BATCH_DEADLINE_MS } from './program-mail.config';
import type { ProgramMailRecipientDeliveryState } from './program-mail-delivery.repository';
import type { ProgramMailBatchWork } from './program-mail-send.types';
import { ProgramMailTemplateService } from './program-mail-template.service';

@Injectable()
export class ProgramMailTransportService {
  constructor(
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    private readonly template: ProgramMailTemplateService,
  ) {}

  async runBatch<Result>(
    operation: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Program mail batch deadline exceeded')),
      PROGRAM_MAIL_BATCH_DEADLINE_MS,
    );
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  send(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
    signal: AbortSignal,
  ): Promise<void> {
    const mail = this.template.build({
      subject: work.subject,
      body: work.body,
      displayName: state.recipient.displayName,
      senderName: work.senderName,
      programName: work.programName,
    });
    return this.mailSender.send(
      {
        to: state.recipient.notificationEmail,
        subject: mail.subject,
        body: mail.text,
        html: mail.html,
      },
      signal,
    );
  }
}
