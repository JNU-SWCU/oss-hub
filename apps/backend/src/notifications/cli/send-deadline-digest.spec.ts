import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function runDigest(input: {
  readonly bootstrapFixture?: boolean;
  readonly forceTo?: string;
  readonly frontendUrl?: string;
  readonly mailMode?: string;
}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    MAIL_MODE: input.mailMode ?? 'dry-run',
    FRONTEND_URL: input.frontendUrl ?? 'https://oss.example',
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  };
  if (input.forceTo === undefined) {
    delete env.DIGEST_FORCE_TO;
  } else {
    env.DIGEST_FORCE_TO = input.forceTo;
  }

  const runtimeArguments = ['-r', 'ts-node/register'];
  if (input.bootstrapFixture) {
    runtimeArguments.push(
      '-e',
      `const { Logger } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
NestFactory.createApplicationContext = async (_module, options) => {
  Logger.overrideLogger(options.logger);
  const serviceLogger = new Logger('DeadlineDigestService');
  return {
    useLogger(logger) { Logger.overrideLogger(logger); },
    get() {
      return {
        async sendDeadlineDigests() {
          serviceLogger.log('bulk service log visible');
        },
      };
    },
    async close() {},
  };
};
require('./src/notifications/cli/send-deadline-digest.ts');`,
    );
  } else {
    runtimeArguments.push('src/notifications/cli/send-deadline-digest.ts');
  }

  return spawnSync(process.execPath, runtimeArguments, {
    cwd: join(__dirname, '..', '..', '..'),
    encoding: 'utf8',
    env,
  });
}

describe('send-deadline-digest forced dry-run CLI', () => {
  it('공유 템플릿의 text와 HTML을 한 합성 수신자에게만 만든다', () => {
    const result = runDigest({
      forceTo: 'synthetic-smoke@example.test',
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toMatch(/bodyChars=[1-9][0-9]* htmlChars=[1-9][0-9]*/);
    expect(output).not.toContain('synthetic-smoke@example.test');
  });

  it('안전하지 않은 FRONTEND_URL을 발송 전에 거부한다', () => {
    const result = runDigest({
      forceTo: 'synthetic-smoke@example.test',
      frontendUrl: 'javascript:alert(1)',
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Deadline digest command failed.',
    );
  });

  it.each([
    ['comma list', 'first@example.test,second@example.test'],
    ['semicolon list', 'first@example.test;second@example.test'],
    ['CRLF injection', 'first@example.test\r\nBcc:second@example.test'],
    ['whitespace list', 'first@example.test second@example.test'],
    ['display name', 'Synthetic Recipient <first@example.test>'],
    ['malformed mailbox', 'not-an-email'],
  ])('%s 입력을 mailer 해석 전에 거부하고 발송하지 않는다', (_, forceTo) => {
    const result = runDigest({ forceTo, mailMode: 'invalid-mode' });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      'DIGEST_FORCE_TO must be exactly one valid email address.',
    );
    expect(output).not.toContain(forceTo);
    expect(output).not.toContain('bodyChars=');
    expect(output).not.toContain('MAIL_MODE');
  });

  it('rejects a defined blank forced recipient before bootstrap', () => {
    const result = runDigest({ forceTo: '   ', mailMode: 'invalid-mode' });

    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'DIGEST_FORCE_TO must be exactly one valid email address.\n',
    );
  });

  it('rejects a defined control-only forced recipient before bootstrap', () => {
    const result = runDigest({ forceTo: '\t\r\n', mailMode: 'invalid-mode' });

    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'DIGEST_FORCE_TO must be exactly one valid email address.\n',
    );
  });

  it('sanitizes provider failures during application bootstrap', () => {
    const result = runDigest({ mailMode: 'invalid-mode' });

    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Deadline digest command failed.\n');
  });

  it('emits service and CLI logs after successful bulk bootstrap', () => {
    const result = runDigest({ bootstrapFixture: true });

    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('bulk service log visible');
    expect(result.stdout).toContain('sendDeadlineDigests 완료');
  });
});
