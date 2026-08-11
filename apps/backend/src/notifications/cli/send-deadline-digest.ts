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
 *   → DB를 전혀 읽지 않고 합성 학생 메일 1통만 이 주소로 보낸다(DB notify 설정 무시).
 *
 * 오버라이드가 없으면 `sendDeadlineDigests`(자동 경로)를 1회 실행한다 —
 * 즉 학생 리마인더만 나가고 교직원 요약은 나가지 않는다(교직원 요약은 수동 발송 전용).
 */
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { isEmail } from 'class-validator';
import { AppModule } from '../../app.module';
import { PROCESS_RUNTIME_CONFIG } from '../../runtime-config/runtime-config.instance';
import { LogMailSender } from '../adapters/log-mail-sender';
import {
  buildStudentDeadlineMail,
  parseFrontendOrigin,
} from '../deadline-digest-mail.template';
import { DeadlineDigestService } from '../deadline-digest.service';
import { resolveMailSender } from '../mail-sender.provider';

const INVALID_FORCE_TO_MESSAGE =
  'DIGEST_FORCE_TO must be exactly one valid email address.';

class InvalidDigestForceToError extends Error {
  override readonly name = 'InvalidDigestForceToError';

  constructor() {
    super(INVALID_FORCE_TO_MESSAGE);
  }
}

function parseDigestForceTo(value: string): string {
  const trimmed = value.trim();
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    value.includes(',') ||
    value.includes(';') ||
    hasControlCharacter ||
    !isEmail(trimmed)
  ) {
    throw new InvalidDigestForceToError();
  }
  return trimmed;
}

async function main(): Promise<void> {
  const logger = new Logger('send-deadline-digest-cli');
  const runtime = PROCESS_RUNTIME_CONFIG;
  const forceToValue = runtime.DIGEST_FORCE_TO;

  // 강제 경로: DB/Nest 없이 메일 어댑터만 사용한다(로컬 점검용). MAIL_MODE 준수.
  if (forceToValue !== undefined) {
    const forceTo = parseDigestForceTo(forceToValue);
    const mailer = resolveMailSender(runtime);
    const usingGmail = !(mailer instanceof LogMailSender);
    if (!usingGmail) {
      logger.warn(
        'MAIL_MODE=dry-run — dry-run 로그만 남깁니다. 실수신을 원하면 MAIL_MODE=send 와 GMAIL_* 4종을 채우세요.',
      );
    }
    const now = new Date();
    const mail = buildStudentDeadlineMail({
      displayName: '합성 로컬 스모크 수신자',
      milestones: [
        {
          id: 'synthetic-local-smoke-milestone',
          programId: 'synthetic-local-smoke-program',
          programName: '합성 로컬 점검 프로그램',
          milestoneName: '강제 발송 스모크 마일스톤',
          dueAt: new Date(now.getTime() + 3_600_000),
        },
      ],
      now,
      frontendOrigin: parseFrontendOrigin(runtime.FRONTEND_URL),
    });
    await mailer.send({
      to: forceTo,
      subject: mail.subject,
      body: mail.text,
      html: mail.html,
    });
    logger.log(
      usingGmail
        ? '강제 실발송 완료 (수신 주소는 로그에 전체 노출하지 않음)'
        : '강제 dry-run 완료',
    );
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  });
  app.useLogger(
    new ConsoleLogger('Nest', { logLevels: ['error', 'warn', 'log'] }),
  );
  try {
    const service = app.get(DeadlineDigestService);
    await service.sendDeadlineDigests(new Date());
    logger.log('sendDeadlineDigests 완료');
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof InvalidDigestForceToError
      ? `${INVALID_FORCE_TO_MESSAGE}\n`
      : 'Deadline digest command failed.\n',
  );
  process.exitCode = 1;
});
