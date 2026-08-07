export interface DeadlineMailMilestone {
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

const BRAND_RED = '#c43c3c';
const TEXT_PRIMARY = '#1f2937';
const TEXT_MUTED = '#6b7280';
const SURFACE = '#f8fafc';
const CARD_BG = '#ffffff';
const BORDER = '#e5e7eb';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function remainingHeadline(dueAt: Date, now: Date): string {
  const ms = dueAt.getTime() - now.getTime();
  if (ms <= 0) {
    return '제출 마감 임박 (긴급)';
  }
  const hours = ms / (60 * 60 * 1000);
  if (hours <= 1) {
    return '제출 마감 1시간 전 (긴급)';
  }
  if (hours <= 3) {
    return '제출 마감 3시간 전';
  }
  if (hours <= 6) {
    return '제출 마감 6시간 전';
  }
  if (hours <= 12) {
    return '제출 마감 12시간 전';
  }
  if (hours <= 24) {
    return '제출 마감 24시간 전';
  }
  const days = Math.ceil(hours / 24);
  return `제출 마감 ${days}일 전`;
}

export function formatDueAtKo(dueAt: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(dueAt);
}

export function buildSubmissionUrl(
  frontendOrigin: string,
  programId: string,
  milestoneId?: string,
): string {
  const origin = frontendOrigin.replace(/\/$/, '');
  const base = `/programs/${programId}/submissions`;
  return milestoneId
    ? `${origin}${base}?milestoneId=${milestoneId}`
    : `${origin}${base}`;
}

function shell(params: {
  readonly headline: string;
  readonly subtitle: string;
  readonly greeting: string;
  readonly lead: string;
  readonly infoRows: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
  }>;
  readonly ctaLabel: string;
  readonly ctaUrl: string;
  readonly footer: string;
}): string {
  const rows = params.infoRows
    .map(
      (row) => `
            <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:${TEXT_PRIMARY};">
              <span style="color:${TEXT_MUTED};">${escapeHtml(row.label)}:</span>
              ${escapeHtml(row.value)}
            </p>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.headline)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;color:${TEXT_PRIMARY};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${SURFACE};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${CARD_BG};border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.06);">
          <tr>
            <td style="background:${BRAND_RED};padding:28px 24px;text-align:center;">
              <div style="font-size:28px;line-height:1;margin-bottom:10px;" aria-hidden="true">🚨</div>
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">
                ${escapeHtml(params.headline)}
              </h1>
              <p style="margin:10px 0 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,0.92);">
                ${escapeHtml(params.subtitle)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px 24px;">
              <p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;">
                ${escapeHtml(params.greeting)}
              </p>
              <p style="margin:0 0 20px 0;font-size:15px;line-height:1.7;color:${TEXT_PRIMARY};">
                ${escapeHtml(params.lead)}
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;background:${CARD_BG};border:1px solid ${BORDER};border-radius:12px;border-left:4px solid ${BRAND_RED};">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 14px 0;font-size:16px;font-weight:700;color:${TEXT_MUTED};">마감 정보</p>
                    ${rows}
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">기한 내 최종 제출을 완료해주세요:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px auto;">
                <tr>
                  <td align="center" style="border-radius:10px;background:${BRAND_RED};">
                    <a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">
                      ${escapeHtml(params.ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
              <div style="margin:0 0 8px 0;padding:14px 16px;background:#f1f5f9;border-radius:10px;">
                <p style="margin:0 0 6px 0;font-size:12px;color:${TEXT_MUTED};">
                  버튼이 작동하지 않으면 아래 링크를 브라우저에 복사하세요:
                </p>
                <p style="margin:0;font-size:13px;word-break:break-all;">
                  <a href="${escapeHtml(params.ctaUrl)}" style="color:#2563eb;text-decoration:underline;">
                    ${escapeHtml(params.ctaUrl)}
                  </a>
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 28px 24px;text-align:center;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${TEXT_MUTED};">
                ${escapeHtml(params.footer)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildStudentDeadlineMail(input: {
  readonly displayName: string;
  readonly milestone: DeadlineMailMilestone & { readonly id: string };
  readonly now: Date;
  readonly frontendOrigin: string;
}): BuiltDeadlineMail {
  const headline = remainingHeadline(input.milestone.dueAt, input.now);
  const dueLabel = formatDueAtKo(input.milestone.dueAt);
  const ctaUrl = buildSubmissionUrl(
    input.frontendOrigin,
    input.milestone.programId,
    input.milestone.id,
  );
  const greeting = `안녕하세요, ${input.displayName}님!`;
  const lead = `"${input.milestone.programName}" 프로그램의 "${input.milestone.milestoneName}" 단계 제출 마감까지 얼마 남지 않았습니다.`;
  const text = [
    greeting,
    '',
    lead,
    '',
    '마감 정보',
    `프로그램: ${input.milestone.programName}`,
    `단계: ${input.milestone.milestoneName}`,
    `마감일시: ${dueLabel}`,
    '',
    `제출하러 가기: ${ctaUrl}`,
    '',
    '본 메일은 oss-hub 시스템에서 자동으로 발송되었습니다.',
  ].join('\n');

  const html = shell({
    headline,
    subtitle: input.milestone.programName,
    greeting,
    lead,
    infoRows: [
      { label: '프로그램', value: input.milestone.programName },
      { label: '단계', value: input.milestone.milestoneName },
      { label: '마감일시', value: dueLabel },
    ],
    ctaLabel: '제출하러 가기',
    ctaUrl,
    footer: '본 메일은 oss-hub 시스템에서 자동으로 발송되었습니다.',
  });

  return {
    subject: `[oss-hub] ${headline} · ${input.milestone.milestoneName}`,
    text,
    html,
  };
}

export function buildStaffDeadlineMail(input: {
  readonly milestones: ReadonlyArray<
    DeadlineMailMilestone & {
      readonly id: string;
      readonly missingNicknames: readonly string[];
    }
  >;
  readonly now: Date;
  readonly frontendOrigin: string;
}): BuiltDeadlineMail {
  const count = input.milestones.length;
  const first = input.milestones[0];
  const headline =
    count === 1 && first
      ? remainingHeadline(first.dueAt, input.now)
      : `마감 임박 마일스톤 ${count}건`;
  const subtitle =
    count === 1 && first ? first.programName : 'oss-hub 운영 다이제스트';
  const dashboardUrl = `${input.frontendOrigin.replace(/\/$/, '')}/staff/dashboard`;
  const lead =
    count === 1 && first
      ? `"${first.programName}" 프로그램의 "${first.milestoneName}" 마감이 임박했습니다. 미제출 현황을 확인해 주세요.`
      : `마감이 임박한 마일스톤이 ${count}건 있습니다. 미제출 현황을 확인해 주세요.`;

  const textLines = input.milestones.flatMap((milestone) => [
    `- ${milestone.programName} / ${milestone.milestoneName} (마감 ${formatDueAtKo(milestone.dueAt)})`,
    `  미제출자: ${milestone.missingNicknames.join(', ') || '없음'}`,
  ]);
  const text = [
    '안녕하세요, 운영진님!',
    '',
    lead,
    '',
    ...textLines,
    '',
    `대시보드: ${dashboardUrl}`,
    '',
    '본 메일은 oss-hub 시스템에서 자동으로 발송되었습니다.',
  ].join('\n');

  const infoRows = input.milestones.flatMap((milestone) => [
    {
      label: '프로그램/단계',
      value: `${milestone.programName} / ${milestone.milestoneName}`,
    },
    {
      label: '마감일시',
      value: formatDueAtKo(milestone.dueAt),
    },
    {
      label: '미제출자',
      value: milestone.missingNicknames.join(', ') || '없음',
    },
  ]);

  const html = shell({
    headline,
    subtitle,
    greeting: '안녕하세요, 운영진님!',
    lead,
    infoRows,
    ctaLabel: '대시보드 열기',
    ctaUrl: dashboardUrl,
    footer: '본 메일은 oss-hub 시스템에서 자동으로 발송되었습니다.',
  });

  return {
    subject: `[oss-hub] ${headline}${count === 1 && first ? ` · ${first.milestoneName}` : ''}`,
    text,
    html,
  };
}
