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

export class FrontendOriginError extends Error {
  override readonly name = 'FrontendOriginError';

  constructor() {
    super('FRONTEND_URL must be an HTTP(S) origin.');
  }
}

export function parseFrontendOrigin(value: string | undefined): URL {
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
              `<tr><th align="left" style="padding:8px;color:#475569;font-size:14px;">${escapeHtml(label)}</th><td style="padding:8px;color:#0f172a;font-size:14px;">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}</table>
<p style="margin:0 0 20px;text-align:center;"><a href="${escapeHtml(item.ctaUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#003399;color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(item.ctaLabel)}</a></p>
<p style="margin:-12px 0 20px;color:#64748b;font-size:12px;word-break:break-all;">${escapeHtml(item.ctaUrl)}</p>`,
    )
    .join('');
  const title = escapeHtml(input.title);
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,'Noto Sans KR',sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f8fafc;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px;background:#003399;color:#ffffff;"><h1 style="margin:0;font-size:22px;">${title}</h1></td></tr>
<tr><td style="padding:24px;"><p style="margin:0 0 12px;font-size:16px;">${escapeHtml(input.greeting)}</p>
<p style="margin:0 0 20px;line-height:1.6;">${escapeHtml(input.lead)}</p>
${items}</td></tr>
</table></td></tr></table></body></html>`;
}

export function buildStudentDeadlineMail(input: {
  readonly displayName: string;
  readonly milestones: readonly [
    DeadlineMailMilestone,
    ...DeadlineMailMilestone[],
  ];
  readonly now: Date;
  readonly frontendOrigin: URL;
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
      `/programs/${encodeURIComponent(milestone.programId)}/submissions?milestoneId=${encodeURIComponent(milestone.id)}`,
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
      items,
    }),
  };
}

export function buildStaffDeadlineMail(input: {
  readonly milestones: readonly (DeadlineMailMilestone & {
    readonly missingNicknames: readonly string[];
  })[];
  readonly now: Date;
  readonly frontendOrigin: URL;
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
      items: [{ rows, ctaLabel: '대시보드 열기', ctaUrl }],
    }),
  };
}
