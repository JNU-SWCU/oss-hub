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

/**
 * 서버가 거절하는 네 게이트를 교직원이 읽을 수 있는 말로 옮긴다.
 * `satisfies`가 완전성을 강제한다 — 사유가 늘면 문구를 주기 전까지 컴파일되지 않는다.
 */
export function applicationModeLabel(mode: ApplicationMode): string {
  return APPLICATION_MODE_LABELS[mode];
}

/**
 * 서버가 새 사유를 먼저 내보내도 화면이 빈칸을 보이지 않도록 `string`을 받고 fallback을 둔다.
 */
export function formatReviewDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

/**
 * 서버 계약은 `{type:'TEXT', text}` | `{type:'FILE', fileId}`뿐이지만, 네트워크를
 * 건너온 값은 컴파일 타임 타입을 보장하지 않는다. 그래서 여기서는 `unknown`으로
 * 다시 좁혀 검증한다 — 예전에는 여기서 걸러지지 않은 값이 그대로
 * `JSON.stringify`로 화면에 새 나갔다(교직원이 raw JSON을 보던 결함).
 */
export function revisionContent(revision: SubmissionRevision): string {
  const content: unknown = revision.content;
  if (typeof content === 'string') return content;
  if (isTextContent(content)) return content.text;
  if (isFileContent(content)) return '';
  return '제출 내용을 표시할 수 없습니다.';
}

/** FILE 유형인데 첨부가 비어 있는지 — RevisionCard가 '파일 제출' 안내로 대신할지 판단하는 근거. */
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
      } catch {
        // 제출 텍스트는 URL이 아닐 수 있다.
      }
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
