import { Test } from '@nestjs/testing';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { GmailMailSender } from './adapters/gmail-mail-sender';
import { LogMailSender } from './adapters/log-mail-sender';
import { mailSenderProvider } from './mail-sender.provider';
import { MAIL_SENDER } from './mail-sender.port';
import type { MailSender } from './mail-sender.port';

const BASE_ENV = { ...process.env };

function frozenSnapshot(
  overrides: Partial<Record<keyof RuntimeConfig, string | undefined>> = {},
): RuntimeConfig {
  return Object.freeze({
    ...loadRuntimeConfig({}),
    ...overrides,
  });
}

async function resolveMailSender(snapshot: RuntimeConfig): Promise<MailSender> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      mailSenderProvider,
      { provide: RUNTIME_CONFIG, useValue: snapshot },
    ],
  }).compile();
  return moduleRef.get<MailSender>(MAIL_SENDER);
}

describe('mailSenderProvider', () => {
  afterEach(() => {
    process.env = { ...BASE_ENV };
  });

  it('production incomplete Gmail credentials throws during provider resolution', async () => {
    await expect(
      resolveMailSender(
        frozenSnapshot({
          NODE_ENV: 'production',
        }),
      ),
    ).rejects.toThrow(/GMAIL_/);
  });

  it('non-production complete four credentials resolves GmailMailSender', async () => {
    const sender = await resolveMailSender(
      frozenSnapshot({
        NODE_ENV: 'development',
        GMAIL_SENDER: 'synthetic-sender@example.com',
        GMAIL_OAUTH_CLIENT_ID: 'synthetic-client-id',
        GMAIL_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
        GMAIL_OAUTH_REFRESH_TOKEN: 'synthetic-refresh-token',
      }),
    );

    expect(sender).toBeInstanceOf(GmailMailSender);
  });

  it('non-production incomplete resolves LogMailSender', async () => {
    const sender = await resolveMailSender(
      frozenSnapshot({
        NODE_ENV: 'development',
      }),
    );

    expect(sender).toBeInstanceOf(LogMailSender);
  });

  it('contradictory process.env values do not override injected snapshot', async () => {
    process.env = {
      ...BASE_ENV,
      NODE_ENV: 'production',
      GMAIL_SENDER: 'env-override@example.com',
      GMAIL_OAUTH_CLIENT_ID: 'env-client-id',
      GMAIL_OAUTH_CLIENT_SECRET: 'env-client-secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'env-refresh-token',
    };

    const sender = await resolveMailSender(
      frozenSnapshot({
        NODE_ENV: 'development',
      }),
    );

    expect(sender).toBeInstanceOf(LogMailSender);
  });
});
