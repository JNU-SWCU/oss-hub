import type { Provider } from '@nestjs/common';
import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../runtime-config/runtime-config.module';
import { GmailMailSender } from './adapters/gmail-mail-sender';
import type { GmailSenderConfig } from './adapters/gmail-mail-sender';
import { LogMailSender } from './adapters/log-mail-sender';
import { MAIL_SENDER } from './mail-sender.port';

function gmailConfigFromRuntime(
  runtimeConfig: RuntimeConfig,
): GmailSenderConfig | null {
  const sender = runtimeConfig.GMAIL_SENDER;
  const clientId = runtimeConfig.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = runtimeConfig.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = runtimeConfig.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!sender || !clientId || !clientSecret || !refreshToken) {
    return null;
  }
  return { sender, clientId, clientSecret, refreshToken };
}

/**
 * 환경에 따라 MailSender 어댑터를 선택한다.
 * - production: Gmail OAuth 자격 필수. 없으면 부팅을 거부한다(dry-run 발송 금지).
 * - 비운영: 자격이 있으면 Gmail, 없으면 dry-run 로그 어댑터.
 */
export const mailSenderProvider: Provider = {
  provide: MAIL_SENDER,
  inject: [RUNTIME_CONFIG],
  useFactory: (runtimeConfig: RuntimeConfig) => {
    const config = gmailConfigFromRuntime(runtimeConfig);
    if (runtimeConfig.NODE_ENV === 'production') {
      if (!config) {
        throw new Error(
          'production 환경은 GMAIL_* OAuth 자격 증명이 필요합니다(dry-run 발송 금지).',
        );
      }
      return new GmailMailSender(config);
    }
    return config ? new GmailMailSender(config) : new LogMailSender();
  },
};
