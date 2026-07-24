import { Logger } from '@nestjs/common';
import type { DeadlineDigestMail, MailSender } from '../mail-sender.port';

/**
 * dev·CI·비운영 환경용 dry-run 어댑터. 실제 발송 대신 로그만 남긴다.
 * production에서는 mail-sender.provider가 이 어댑터 선택을 거부한다.
 */
export class LogMailSender implements MailSender {
  private readonly logger = new Logger('LogMailSender');

  send(mail: DeadlineDigestMail): Promise<void> {
    this.logger.log(
      `[dry-run] 마감 알림 메일 to=${mail.to} subject=${mail.subject}`,
    );
    return Promise.resolve();
  }
}
