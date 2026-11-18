import { Injectable } from '@nestjs/common';
import type { BuiltDeadlineMail } from './deadline-digest-mail.service';

const FOOTER = '이 메일은 oss-hub에서 발송했습니다.';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type ProgramMailTemplateInput = {
  readonly subject: string;
  readonly body: string;
  readonly displayName: string;
  readonly senderName: string;
  readonly programName: string;
};

@Injectable()
export class ProgramMailTemplateService {
  build(input: ProgramMailTemplateInput): BuiltDeadlineMail {
    const subject = `[oss-hub] ${input.subject}`;
    const text = [
      `안녕하세요, ${input.displayName}님.`,
      '',
      `프로그램: ${input.programName}`,
      `보낸 사람: ${input.senderName}`,
      '',
      input.body,
      '',
      '--',
      FOOTER,
    ].join('\n');
    return {
      subject,
      text,
      html: this.renderHtml({ ...input, subject }),
    };
  }

  private renderHtml(
    input: ProgramMailTemplateInput & { readonly subject: string },
  ): string {
    const title = escapeHtml(input.subject);
    return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,'Noto Sans KR',sans-serif;word-break:keep-all;overflow-wrap:anywhere;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f8fafc;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px;background:#003399;color:#ffffff;"><h1 style="margin:0;font-size:22px;">${title}</h1></td></tr>
<tr><td style="padding:24px;"><p style="margin:0 0 16px;font-size:16px;">안녕하세요, ${escapeHtml(input.displayName)}님.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:8px;">
<tr><th align="left" style="padding:8px;color:#475569;font-size:14px;">프로그램</th><td style="padding:8px;color:#0f172a;font-size:14px;">${escapeHtml(input.programName)}</td></tr>
<tr><th align="left" style="padding:8px;color:#475569;font-size:14px;">보낸 사람</th><td style="padding:8px;color:#0f172a;font-size:14px;">${escapeHtml(input.senderName)}</td></tr>
</table>
<p style="margin:0 0 24px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(input.body)}</p>
<p style="margin:0;padding-top:16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">${FOOTER}</p>
</td></tr></table></td></tr></table></body></html>`;
  }
}
