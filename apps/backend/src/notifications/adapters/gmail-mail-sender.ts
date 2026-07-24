import { createTransport, type Transporter } from 'nodemailer';
import type { DeadlineDigestMail, MailSender } from '../mail-sender.port';

export interface GmailSenderConfig {
  readonly sender: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/**
 * 팀 Gmail 계정 + Gmail API(OAuth2) 발송 어댑터. 자체 SMTP는 구축하지 않는다(#127).
 * 자격 증명은 환경변수로만 주입한다(값은 팀 Notion, 커밋 금지).
 */
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
    });
  }
}
