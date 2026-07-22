import type {
  ApplicationMode,
  ReviewDecision,
  SubmissionRevision,
} from './types';

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

const BLOCKED_REASON_LABELS: Readonly<Record<string, string>> = {
  REQUIRED_MILESTONES_NOT_APPROVED: '모든 필수 마일스톤의 승인이 필요합니다.',
  REPOSITORY_NOT_READY: '저장소 준비가 완료되지 않았습니다.',
};

export function applicationModeLabel(mode: ApplicationMode): string {
  return APPLICATION_MODE_LABELS[mode];
}

export function blockedReasonLabel(reason: string): string {
  return (
    BLOCKED_REASON_LABELS[reason] ??
    '저장소 공개 조건이 아직 충족되지 않았습니다.'
  );
}

export function formatReviewDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function revisionContent(revision: SubmissionRevision): string {
  if (typeof revision.content === 'string') return revision.content;
  return JSON.stringify(revision.content, null, 2) ?? '제출 내용이 없습니다.';
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
