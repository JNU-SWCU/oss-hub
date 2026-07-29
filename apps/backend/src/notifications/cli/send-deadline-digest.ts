/**
 * 로컬/실증용 마감 다이제스트 1회 발송.
 *
 * 사용:
 *   cd apps/backend
 *   DATABASE_URL=... pnpm exec ts-node src/notifications/cli/send-deadline-digest.ts
 *
 * 메일 정책:
 *   MAIL_MODE=send|dry-run (필수 — 앱/강제 CLI 공통 권한)
 *   send 시 GMAIL_SENDER / GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REFRESH_TOKEN
 *
 * 수신자 오버라이드(본인 점검):
 *   DIGEST_FORCE_TO=you@example.com
 *   → STAFF 조회 대신 이 주소로 1통만 보낸다(DB notify 설정 무시).
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { LogMailSender } from '../adapters/log-mail-sender';
import { DeadlineDigestService } from '../deadline-digest.service';
import { resolveMailSender } from '../mail-sender.provider';

async function main(): Promise<void> {
  const logger = new Logger('send-deadline-digest-cli');
  const runtime = loadRuntimeConfig(process.env);
  const forceTo = runtime.DIGEST_FORCE_TO?.trim();

  // 강제 경로: DB/Nest 없이 메일 어댑터만 사용한다(로컬 점검용). MAIL_MODE 준수.
  if (forceTo) {
    const mailer = resolveMailSender(runtime);
    const usingGmail = !(mailer instanceof LogMailSender);
    if (!usingGmail) {
      logger.warn(
        'MAIL_MODE=dry-run — dry-run 로그만 남깁니다. 실수신을 원하면 MAIL_MODE=send 와 GMAIL_* 4종을 채우세요.',
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
