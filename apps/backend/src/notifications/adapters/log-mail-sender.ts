import { Logger } from '@nestjs/common';
import type { DeadlineDigestMail, MailSender } from '../mail-sender.port';

export class LogMailSender implements MailSender {
  private readonly logger = new Logger('LogMailSender');

  send(mail: DeadlineDigestMail): Promise<void> {
    this.logger.log(
      `[dry-run] deadline digest prepared bodyChars=${mail.body.length} htmlChars=${mail.html?.length ?? 0}`,
    );
    return Promise.resolve();
  }
}
