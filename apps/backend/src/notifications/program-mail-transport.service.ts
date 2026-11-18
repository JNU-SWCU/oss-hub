import { Inject, Injectable } from '@nestjs/common';
import { type MailSender, MAIL_SENDER } from './gmail-mail.client';
import type { ProgramMailRecipientDeliveryState } from './program-mail-delivery.repository';
import type { ProgramMailBatchWork } from './program-mail-send.types';
import { ProgramMailTemplateService } from './program-mail-template.service';

@Injectable()
export class ProgramMailTransportService {
  constructor(
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    private readonly template: ProgramMailTemplateService,
  ) {}

  send(
    work: ProgramMailBatchWork,
    state: ProgramMailRecipientDeliveryState,
  ): Promise<void> {
    const mail = this.template.build({
      subject: work.subject,
      body: work.body,
      displayName: state.recipient.displayName,
      senderName: work.senderName,
      programName: work.programName,
    });
    return this.mailSender.send({
      to: state.recipient.notificationEmail,
      subject: mail.subject,
      body: mail.text,
      html: mail.html,
    });
  }
}
