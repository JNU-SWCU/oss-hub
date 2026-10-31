import { Injectable, type Logger, type Provider } from '@nestjs/common';
import { isEmail } from 'class-validator';
import {
  FrontendOriginError,
  InvalidDigestForceToError,
} from './deadline-digest-failure.error';
import type { RuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import {
  GmailMailClient,
  type GmailSenderConfig,
  LogMailClient,
  type MailSender,
  MAIL_SENDER,
} from './gmail-mail.client';

export interface DeadlineMailMilestone {
  readonly id: string;
  readonly programId: string;
  readonly programName: string;
  readonly milestoneName: string;
  readonly dueAt: Date;
}

export interface BuiltDeadlineMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDueAt(dueAt: Date): string {
  const formatted = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(dueAt);
  return `${formatted} (Asia/Seoul)`;
}

function deadlineHeadline(dueAt: Date, now: Date): string {
  const remainingHours = (dueAt.getTime() - now.getTime()) / 3_600_000;
  if (remainingHours <= 1) return '제출 마감 1시간 전';
  if (remainingHours <= 3) return '제출 마감 3시간 전';
  if (remainingHours <= 6) return '제출 마감 6시간 전';
  if (remainingHours <= 12) return '제출 마감 12시간 전';
  return '제출 마감 24시간 전';
}

function routeUrl(origin: URL, path: string): string {
  return new URL(path, origin).toString();
}

function renderHtml(input: {
  readonly title: string;
  readonly greeting: string;
  readonly lead: string;
  readonly guidance?: string;
  readonly items: readonly {
    readonly rows: readonly {
      readonly label: string;
      readonly value: string;
    }[];
    readonly ctaLabel: string;
    readonly ctaUrl: string;
  }[];
}): string {
  const items = input.items
    .map(
      (item) =>
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:12px;border:1px solid #e2e8f0;border-radius:8px;">${item.rows
          .map(
            ({ label, value }) =>
              `<tr><th align="left" style="padding:8px;color:#475569;font-size:14px;overflow-wrap:normal;">${escapeHtml(label)}</th><td style="padding:8px;color:#0f172a;font-size:14px;">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}</table>
<p style="margin:0 0 20px;text-align:center;"><a href="${escapeHtml(item.ctaUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#003399;color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(item.ctaLabel)}</a></p>
<p style="margin:-12px 0 20px;color:#64748b;font-size:12px;word-break:break-all;">${escapeHtml(item.ctaUrl)}</p>`,
    )
    .join('');
  const title = escapeHtml(input.title);
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,'Noto Sans KR',sans-serif;word-break:keep-all;overflow-wrap:anywhere;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f8fafc;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px;background:#003399;color:#ffffff;"><h1 style="margin:0;font-size:22px;">${title}</h1></td></tr>
<tr><td style="padding:24px;"><p style="margin:0 0 12px;font-size:16px;">${escapeHtml(input.greeting)}</p>
<p style="margin:0 0 20px;line-height:1.6;">${escapeHtml(input.lead)}</p>
${input.guidance ? `<p style="margin:0 0 20px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(input.guidance)}</p>` : ''}
${items}</td></tr>
</table></td></tr></table></body></html>`;
}

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

function isDryRunMailSender(mailSender: MailSender): boolean {
  return mailSender instanceof LogMailClient;
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

@Injectable()
export class DeadlineDigestMailService {
  parseFrontendOrigin(value: string | undefined): URL {
    const trimmed = value?.trim();
    if (!trimmed || !URL.canParse(trimmed)) throw new FrontendOriginError();
    const url = new URL(trimmed);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new FrontendOriginError();
    }
    return url;
  }

  buildStudentDeadlineMail(input: {
    readonly displayName: string;
    readonly milestones: readonly [
      DeadlineMailMilestone,
      ...DeadlineMailMilestone[],
    ];
    readonly now: Date;
    readonly frontendOrigin: URL;
    readonly guidance?: string;
  }): BuiltDeadlineMail {
    const first = input.milestones[0];
    const title =
      input.milestones.length === 1
        ? `${deadlineHeadline(first.dueAt, input.now)} · ${first.milestoneName}`
        : `마감 임박 제출 ${input.milestones.length}건`;
    const lead = `제출 마감이 임박한 마일스톤이 ${input.milestones.length}건 있습니다.`;
    const items = input.milestones.map((milestone) => {
      const ctaUrl = routeUrl(
        input.frontendOrigin,
        `/programs/${encodeURIComponent(milestone.programId)}#milestone-${encodeURIComponent(milestone.id)}-name`,
      );
      return {
        rows: [
          { label: '프로그램', value: milestone.programName },
          { label: '마일스톤', value: milestone.milestoneName },
          { label: '마감일시', value: formatDueAt(milestone.dueAt) },
        ],
        ctaLabel: '제출하러 가기',
        ctaUrl,
      } as const;
    });
    const text = [
      `안녕하세요, ${input.displayName}님.`,
      '',
      lead,
      '',
      ...(input.guidance ? [input.guidance, ''] : []),
      ...items.flatMap((item) => [
        ...item.rows.map(({ label, value }) => `${label}: ${value}`),
        `제출하러 가기: ${item.ctaUrl}`,
        '',
      ]),
    ].join('\n');
    return {
      subject: `[oss-hub] ${title}`,
      text,
      html: renderHtml({
        title,
        greeting: `안녕하세요, ${input.displayName}님.`,
        lead,
        guidance: input.guidance,
        items,
      }),
    };
  }

  buildStaffDeadlineMail(input: {
    readonly milestones: readonly (DeadlineMailMilestone & {
      readonly missingNicknames: readonly string[];
    })[];
    readonly now: Date;
    readonly frontendOrigin: URL;
    readonly guidance?: string;
  }): BuiltDeadlineMail {
    const first = input.milestones[0];
    const title =
      input.milestones.length === 1 && first
        ? `${deadlineHeadline(first.dueAt, input.now)} · ${first.milestoneName}`
        : `마감 임박 마일스톤 ${input.milestones.length}건`;
    const ctaUrl = routeUrl(input.frontendOrigin, '/dashboard');
    const rows = input.milestones.flatMap((milestone) => [
      {
        label: '프로그램 / 마일스톤',
        value: `${milestone.programName} / ${milestone.milestoneName}`,
      },
      { label: '마감일시', value: formatDueAt(milestone.dueAt) },
      {
        label: '미제출자',
        value: milestone.missingNicknames.join(', ') || '없음',
      },
    ]);
    const lead = `마감이 임박한 마일스톤이 ${input.milestones.length}건 있습니다.`;
    const text = [
      '안녕하세요, 운영진님.',
      '',
      lead,
      '',
      ...(input.guidance ? [input.guidance, ''] : []),
      ...rows.map(({ label, value }) => `${label}: ${value}`),
      '',
      `대시보드 열기: ${ctaUrl}`,
    ].join('\n');
    return {
      subject: `[oss-hub] ${title}`,
      text,
      html: renderHtml({
        title,
        greeting: '안녕하세요, 운영진님.',
        lead,
        guidance: input.guidance,
        items: [{ rows, ctaLabel: '대시보드 열기', ctaUrl }],
      }),
    };
  }

  resolveMailSender(runtimeConfig: RuntimeConfig): MailSender {
    const mode = runtimeConfig.MAIL_MODE;
    if (mode !== 'send' && mode !== 'dry-run') {
      throw new Error(
        `MAIL_MODE must be "send" or "dry-run" (received ${mode === undefined || mode.trim() === '' ? 'missing/blank' : JSON.stringify(mode)}).`,
      );
    }
    if (mode === 'dry-run') return new LogMailClient();
    const config = gmailConfigFromRuntime(runtimeConfig);
    if (!config) {
      throw new Error(
        'MAIL_MODE=send requires GMAIL_SENDER and GMAIL_OAUTH_* credentials.',
      );
    }
    return new GmailMailClient(config);
  }

  async sendForcedDeadlineDigest(
    runtime: RuntimeConfig,
    forceToValue: string,
    logger: Logger,
  ): Promise<void> {
    const forceTo = parseDigestForceTo(forceToValue);
    const mailer = this.resolveMailSender(runtime);
    const usingGmail = !isDryRunMailSender(mailer);
    if (!usingGmail) {
      logger.warn(
        'MAIL_MODE=dry-run — dry-run 로그만 남깁니다. 실수신을 원하면 MAIL_MODE=send 와 GMAIL_* 4종을 채우세요.',
      );
    }
    const now = new Date();
    const mail = this.buildStudentDeadlineMail({
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
      frontendOrigin: this.parseFrontendOrigin(runtime.FRONTEND_URL),
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
  }
}

export const mailSenderProvider: Provider = {
  provide: MAIL_SENDER,
  inject: [RUNTIME_CONFIG, DeadlineDigestMailService],
  useFactory: (runtimeConfig: RuntimeConfig, mail: DeadlineDigestMailService) =>
    mail.resolveMailSender(runtimeConfig),
};
