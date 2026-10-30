import type { Provider } from '@nestjs/common';
import type { RuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { GmailMailSender } from './mail.client';
import type { GmailSenderConfig } from './mail.client';
import { LogMailSender } from './mail.client';
import type { MailSender } from './mail-sender.types';
import { MAIL_SENDER } from './mail-sender.types';

function gmailConfigFromRuntime(
  runtimeConfig: RuntimeConfig,
): GmailSenderConfig | null {
  const values = [
    runtimeConfig.GMAIL_SENDER,
    runtimeConfig.GMAIL_OAUTH_CLIENT_ID,
    runtimeConfig.GMAIL_OAUTH_CLIENT_SECRET,
    runtimeConfig.GMAIL_OAUTH_REFRESH_TOKEN,
  ];
  if (values.some((value) => value?.trim() === '')) {
    return null;
  }
  const [sender, clientId, clientSecret, refreshToken] = values.map((value) =>
    value?.trim(),
  );
  if (!sender || !clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return { sender, clientId, clientSecret, refreshToken };
}

export function isDryRunMailSender(mailSender: MailSender): boolean {
  return mailSender instanceof LogMailSender;
}

export function resolveMailSender(runtimeConfig: RuntimeConfig): MailSender {
  const mode = runtimeConfig.MAIL_MODE;
  if (mode !== 'send' && mode !== 'dry-run') {
    throw new Error(
      `MAIL_MODE must be "send" or "dry-run" (received ${mode === undefined || mode.trim() === '' ? 'missing/blank' : JSON.stringify(mode)}).`,
    );
  }
  if (mode === 'dry-run') return new LogMailSender();
  const config = gmailConfigFromRuntime(runtimeConfig);
  if (!config) {
    throw new Error(
      'MAIL_MODE=send requires GMAIL_SENDER and GMAIL_OAUTH_* credentials.',
    );
  }
  return new GmailMailSender(config);
}

export const mailSenderProvider: Provider = {
  provide: MAIL_SENDER,
  inject: [RUNTIME_CONFIG],
  useFactory: (runtimeConfig: RuntimeConfig) =>
    resolveMailSender(runtimeConfig),
};
