export interface DeadlineDigestMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface MailSender {
  send(mail: DeadlineDigestMail): Promise<void>;
}

export const MAIL_SENDER = Symbol('NOTIFICATIONS_MAIL_SENDER');
