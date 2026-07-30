import { Test } from '@nestjs/testing';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { GmailMailSender } from './adapters/gmail-mail-sender';
import { LogMailSender } from './adapters/log-mail-sender';
import { mailSenderProvider, resolveMailSender } from './mail-sender.provider';
import { MAIL_SENDER } from './mail-sender.port';
import type { MailSender } from './mail-sender.port';

const BASE_ENV = { ...process.env };

const COMPLETE_GMAIL = {
  GMAIL_SENDER: 'synthetic-sender@example.com',
  GMAIL_OAUTH_CLIENT_ID: 'synthetic-client-id',
  GMAIL_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
  GMAIL_OAUTH_REFRESH_TOKEN: 'synthetic-refresh-token',
} as const;

function frozenSnapshot(
  overrides: Partial<Record<keyof RuntimeConfig, string | undefined>> = {},
): RuntimeConfig {
  return Object.freeze({
    ...loadRuntimeConfig({}),
    ...overrides,
  });
}

async function resolveViaProvider(
  snapshot: RuntimeConfig,
): Promise<MailSender> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      mailSenderProvider,
      { provide: RUNTIME_CONFIG, useValue: snapshot },
    ],
  }).compile();
  return moduleRef.get<MailSender>(MAIL_SENDER);
}

describe('resolveMailSender / mailSenderProvider', () => {
  afterEach(() => {
    process.env = { ...BASE_ENV };
  });

  it('missing MAIL_MODE throws', () => {
    expect(() => resolveMailSender(frozenSnapshot({}))).toThrow(/MAIL_MODE/);
  });

  it('blank MAIL_MODE throws', () => {
    expect(() => resolveMailSender(frozenSnapshot({ MAIL_MODE: '' }))).toThrow(
      /MAIL_MODE/,
    );
  });

  it('invalid MAIL_MODE throws', () => {
    expect(() =>
      resolveMailSender(frozenSnapshot({ MAIL_MODE: 'production' })),
    ).toThrow(/MAIL_MODE/);
    expect(() =>
      resolveMailSender(frozenSnapshot({ MAIL_MODE: 'real' })),
    ).toThrow(/MAIL_MODE/);
  });

  it('dry-run with complete credentials resolves LogMailSender', () => {
    const sender = resolveMailSender(
      frozenSnapshot({
        MAIL_MODE: 'dry-run',
        ...COMPLETE_GMAIL,
      }),
    );
    expect(sender).toBeInstanceOf(LogMailSender);
  });

  it('dry-run with incomplete credentials resolves LogMailSender', () => {
    const sender = resolveMailSender(
      frozenSnapshot({
        MAIL_MODE: 'dry-run',
      }),
    );
    expect(sender).toBeInstanceOf(LogMailSender);
  });

  it('send with complete four credentials resolves GmailMailSender', () => {
    const sender = resolveMailSender(
      frozenSnapshot({
        MAIL_MODE: 'send',
        ...COMPLETE_GMAIL,
      }),
    );
    expect(sender).toBeInstanceOf(GmailMailSender);
  });

  it.each([
    ['GMAIL_SENDER'],
    ['GMAIL_OAUTH_CLIENT_ID'],
    ['GMAIL_OAUTH_CLIENT_SECRET'],
    ['GMAIL_OAUTH_REFRESH_TOKEN'],
  ] as const)('send missing %s throws', (missingKey) => {
    const overrides: Partial<Record<keyof RuntimeConfig, string | undefined>> =
      {
        MAIL_MODE: 'send',
        ...COMPLETE_GMAIL,
        [missingKey]: undefined,
      };
    expect(() => resolveMailSender(frozenSnapshot(overrides))).toThrow(
      /GMAIL_/,
    );
  });

  it('send with blank Gmail credential throws', () => {
    expect(() =>
      resolveMailSender(
        frozenSnapshot({
          MAIL_MODE: 'send',
          ...COMPLETE_GMAIL,
          GMAIL_SENDER: '',
        }),
      ),
    ).toThrow(/GMAIL_/);
  });

  it.each([
    ['GMAIL_SENDER'],
    ['GMAIL_OAUTH_CLIENT_ID'],
    ['GMAIL_OAUTH_CLIENT_SECRET'],
    ['GMAIL_OAUTH_REFRESH_TOKEN'],
  ] as const)('send with whitespace-only %s throws', (blankKey) => {
    expect(() =>
      resolveMailSender(
        frozenSnapshot({
          MAIL_MODE: 'send',
          ...COMPLETE_GMAIL,
          [blankKey]: '   ',
        }),
      ),
    ).toThrow(/GMAIL_/);
  });

  it('provider DI delegates to the same MAIL_MODE policy', async () => {
    const sender = await resolveViaProvider(
      frozenSnapshot({
        MAIL_MODE: 'dry-run',
        ...COMPLETE_GMAIL,
      }),
    );
    expect(sender).toBeInstanceOf(LogMailSender);
  });

  it('contradictory process.env values do not override injected snapshot', async () => {
    process.env = {
      ...BASE_ENV,
      MAIL_MODE: 'send',
      GMAIL_SENDER: 'env-override@example.com',
      GMAIL_OAUTH_CLIENT_ID: 'env-client-id',
      GMAIL_OAUTH_CLIENT_SECRET: 'env-client-secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'env-refresh-token',
    };

    const sender = await resolveViaProvider(
      frozenSnapshot({
        MAIL_MODE: 'dry-run',
      }),
    );

    expect(sender).toBeInstanceOf(LogMailSender);
  });
});
