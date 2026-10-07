import type {
  ApplicationMode,
  ReviewDecision,
  SubmissionRevision,
} from './types';
export { blockedReasonLabel } from '@/lib/repository-publication';

export const DECISION_PRESENTATION = {
  APPROVED: { label: '승인', variant: 'approved' },
  CHANGES_REQUESTED: { label: '보완 요청', variant: 'pending' },
  REJECTED: { label: '최종 반려', variant: 'rejected' },
} as const satisfies Readonly<
  Record<
    ReviewDecision,
    {
      readonly label: string;
      readonly variant: 'approved' | 'pending' | 'rejected';
    }
  >
>;

const APPLICATION_MODE_LABELS = {
  PERSONAL: '개인',
  TEAM: '팀',
} as const satisfies Readonly<Record<ApplicationMode, string>>;

export function applicationModeLabel(mode: ApplicationMode): string {
  return APPLICATION_MODE_LABELS[mode];
}

export function formatReviewDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function revisionContent(revision: SubmissionRevision): string {
  const content: unknown = revision.content;
  if (typeof content === 'string') return content;
  if (isTextContent(content)) return content.text;
  if (isFileContent(content)) return '';
  return '제출 내용을 표시할 수 없습니다.';
}

export function isFileOnlyRevision(revision: SubmissionRevision): boolean {
  return isFileContent(revision.content);
}

function isTextContent(
  value: unknown,
): value is { readonly type: 'TEXT'; readonly text: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'TEXT' &&
    'text' in value &&
    typeof value.text === 'string'
  );
}

function isFileContent(value: unknown): value is { readonly type: 'FILE' } {
  return (
    !!value &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'FILE'
  );
}

export function revisionLinks(revision: SubmissionRevision): readonly string[] {
  const links = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          links.add(url.href);
        }
      } catch {}
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(revision.content);
  return [...links];
}
