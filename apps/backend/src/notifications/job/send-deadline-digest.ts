import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { isEmail } from 'class-validator';
import { AppModule } from '../../app.module';
import { PROCESS_RUNTIME_CONFIG } from '../../runtime-config/runtime-config.instance';
import {
  buildStudentDeadlineMail,
  parseFrontendOrigin,
} from '../domain/deadline-digest-mail.template';
import { DeadlineDigestService } from '../service/deadline-digest.service';
import {
  isDryRunMailSender,
  resolveMailSender,
} from '../service/mail-sender.provider';

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

  if (forceToValue !== undefined) {
    const forceTo = parseDigestForceTo(forceToValue);
    const mailer = resolveMailSender(runtime);
    const usingGmail = !isDryRunMailSender(mailer);
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
