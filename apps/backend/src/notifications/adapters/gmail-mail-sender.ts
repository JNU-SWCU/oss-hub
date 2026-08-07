import { createTransport, type Transporter } from 'nodemailer';
import type { DeadlineDigestMail, MailSender } from '../mail-sender.port';

export interface GmailSenderConfig {
  readonly sender: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export class GmailMailSender implements MailSender {
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
      ...(mail.html !== undefined ? { html: mail.html } : {}),
    });
  }
}
