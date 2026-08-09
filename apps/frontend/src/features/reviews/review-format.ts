import type {
  ApplicationMode,
  PublishBlockedReason,
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

/**
 * 서버가 거절하는 네 게이트를 교직원이 읽을 수 있는 말로 옮긴다.
 * `satisfies`가 완전성을 강제한다 — 사유가 늘면 문구를 주기 전까지 컴파일되지 않는다.
 */
const BLOCKED_REASON_LABELS = {
  REPOSITORY_NOT_READY:
    '저장소 생성이 아직 끝나지 않았습니다. 생성이 끝난 뒤 이 화면을 새로고침해 주세요.',
  REPOSITORY_PUBLICATION_NOT_PLANNED:
    '이 신청은 저장소 공개 예정이 "아니요"입니다. 제출 이후에는 바꿀 수 없어 이 저장소는 공개 대상이 아닙니다.',
  PROGRAM_NOT_ENDED:
    '프로그램이 아직 종료되지 않아 공개할 수 없습니다. 프로그램 설정에서 종료일을 확인해 주세요 — 종료일이 비어 있으면 종료되지 않은 것으로 봅니다.',
  REQUIRED_MILESTONES_NOT_APPROVED: '모든 필수 마일스톤의 승인이 필요합니다.',
} as const satisfies Readonly<Record<PublishBlockedReason, string>>;

export function applicationModeLabel(mode: ApplicationMode): string {
  return APPLICATION_MODE_LABELS[mode];
}

/**
 * 서버가 새 사유를 먼저 내보내도 화면이 빈칸을 보이지 않도록 `string`을 받고 fallback을 둔다.
 */
export function blockedReasonLabel(reason: string): string {
  const labels: Readonly<Record<string, string | undefined>> =
    BLOCKED_REASON_LABELS;
  return (
    labels[reason] ??
    '아직 공개 조건을 충족하지 않았습니다. 저장소 생성 상태·저장소 공개 예정 여부·프로그램 종료일·필수 마일스톤 승인을 확인해 주세요.'
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
