/**
 * 로컬/실증용 마감 다이제스트 1회 발송.
 *
 * 사용:
 *   cd apps/backend
 *   DATABASE_URL=... pnpm exec ts-node src/notifications/cli/send-deadline-digest.ts
 *
 * 실 Gmail:
 *   GMAIL_SENDER / GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN
 *   NOTIFICATION_MAIL_REAL_SEND=1 (선택 — 값이 없어도 GMAIL_* 가 있으면 Gmail 사용)
 *
 * 수신자 오버라이드(본인 점검):
 *   DIGEST_FORCE_TO=you@example.com
 *   → STAFF 조회 대신 이 주소로 1통만 보낸다(DB notify 설정 무시).
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { GmailMailSender } from '../adapters/gmail-mail-sender';
import { LogMailSender } from '../adapters/log-mail-sender';
import { DeadlineDigestService } from '../deadline-digest.service';
import type { MailSender } from '../mail-sender.port';

async function main(): Promise<void> {
  const logger = new Logger('send-deadline-digest-cli');
  const forceTo = process.env.DIGEST_FORCE_TO?.trim();

  // 강제 수신은 DB/Nest 없이 메일 어댑터만 사용한다(로컬 점검용).
  if (forceTo) {
    const mailer = resolveMailer();
    const usingGmail = !(mailer instanceof LogMailSender);
    if (!usingGmail) {
      logger.warn(
        'GMAIL_* 미설정 — dry-run 로그만 남깁니다. 실수신을 원하면 GMAIL_SENDER·OAuth 4종을 채우세요.',
      );
    }
    const subject = '[oss-hub] 로컬 점검 다이제스트 (강제 수신)';
    const body = [
      'oss-hub 로컬 점검용 테스트 메일입니다.',
      '',
      `at=${new Date().toISOString()}`,
      '',
      '실제 마일스톤 배치가 아니라 CLI 강제 발송입니다.',
    ].join('\n');
    await mailer.send({ to: forceTo, subject, body });
    logger.log(
      usingGmail
        ? '강제 실발송 완료 (수신 주소는 로그에 전체 노출하지 않음)'
        : '강제 dry-run 완료',
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const service = app.get(DeadlineDigestService);
    await service.sendDeadlineDigests(new Date());
    logger.log('sendDeadlineDigests 완료');
  } finally {
    await app.close();
  }
}

function resolveMailer(): MailSender {
  const sender = process.env.GMAIL_SENDER;
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (sender && clientId && clientSecret && refreshToken) {
    return new GmailMailSender({
      sender,
      clientId,
      clientSecret,
      refreshToken,
    });
  }
  return new LogMailSender();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
