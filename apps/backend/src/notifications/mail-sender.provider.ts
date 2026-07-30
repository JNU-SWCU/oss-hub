import type { Provider } from '@nestjs/common';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { GmailMailSender } from './adapters/gmail-mail-sender';
import type { GmailSenderConfig } from './adapters/gmail-mail-sender';
import { LogMailSender } from './adapters/log-mail-sender';
import type { MailSender } from './mail-sender.port';
import { MAIL_SENDER } from './mail-sender.port';

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

/**
 * MAIL_MODE is the sole mail behavior authority.
 * - dry-run: always LogMailSender (even when Gmail credentials exist)
 * - send: all four Gmail fields required; otherwise throws
 * - missing/blank/other: throws
 */
export function resolveMailSender(runtimeConfig: RuntimeConfig): MailSender {
  const mode = runtimeConfig.MAIL_MODE;
  if (mode !== 'send' && mode !== 'dry-run') {
    throw new Error(
      `MAIL_MODE must be "send" or "dry-run" (received ${mode === undefined || mode === '' ? 'missing/blank' : JSON.stringify(mode)}).`,
    );
  }
  if (mode === 'dry-run') {
    return new LogMailSender();
  }
  const config = gmailConfigFromRuntime(runtimeConfig);
  if (!config) {
    throw new Error(
      'MAIL_MODE=send requires GMAIL_SENDER and GMAIL_OAUTH_* credentials.',
    );
  }
  return new GmailMailSender(config);
}

/**
 * Nest provider: delegates to resolveMailSender so AppModule DI and the
 * forced deadline-digest CLI share one MAIL_MODE policy.
 */
export const mailSenderProvider: Provider = {
  provide: MAIL_SENDER,
  inject: [RUNTIME_CONFIG],
  useFactory: (runtimeConfig: RuntimeConfig) =>
    resolveMailSender(runtimeConfig),
};
