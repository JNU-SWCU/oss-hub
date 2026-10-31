import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface DeadlineDigestMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly html?: string;
}

export interface MailSender {
  send(mail: DeadlineDigestMail): Promise<void>;
}

export const MAIL_SENDER = Symbol('NOTIFICATIONS_MAIL_SENDER');

export interface GmailSenderConfig {
  readonly sender: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export class GmailMailClient implements MailSender {
  private readonly transporter: Transporter;

  constructor(private readonly config: GmailSenderConfig) {
    this.transporter = createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: config.sender,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
      },
    });
  }

  async send(mail: DeadlineDigestMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.sender,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
      html: mail.html,
    });
  }
}

export class LogMailClient implements MailSender {
  private readonly logger = new Logger('LogMailSender');

  send(mail: DeadlineDigestMail): Promise<void> {
    this.logger.log(
      `[dry-run] deadline digest prepared bodyChars=${mail.body.length} htmlChars=${mail.html?.length ?? 0}`,
    );
    return Promise.resolve();
  }
}
