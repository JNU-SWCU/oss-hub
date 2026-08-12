import { apiClient } from './api-client';

export type RepositoryVisibility = 'PRIVATE' | 'PUBLIC';

export type PublishBlockedReason =
  | 'REPOSITORY_NOT_READY'
  | 'REPOSITORY_PUBLICATION_NOT_PLANNED'
  | 'PROGRAM_NOT_ENDED'
  | 'REQUIRED_MILESTONES_NOT_APPROVED';

export interface RepositoryPublication {
  readonly id: string;
  readonly url: string;
  readonly visibility: RepositoryVisibility;
  readonly publishEligible: boolean;
  readonly blockedReasons: readonly PublishBlockedReason[];
}

export interface PublishRepositoryResponse {
  readonly repositoryId: string;
  readonly visibility: 'PUBLIC';
  readonly publishedAt: string;
}

const BLOCKED_REASON_LABELS = {
  REPOSITORY_NOT_READY:
    '저장소 생성이 아직 끝나지 않았습니다. 생성이 끝난 뒤 이 화면을 새로고침해 주세요.',
  REPOSITORY_PUBLICATION_NOT_PLANNED:
    '이 신청은 저장소 공개 예정이 "아니요"입니다. 제출 이후에는 바꿀 수 없어 이 저장소는 공개 대상이 아닙니다.',
  PROGRAM_NOT_ENDED:
    '프로그램이 아직 종료되지 않아 공개할 수 없습니다. 프로그램 설정에서 종료일을 확인해 주세요 — 종료일이 비어 있으면 종료되지 않은 것으로 봅니다.',
  REQUIRED_MILESTONES_NOT_APPROVED: '모든 필수 마일스톤의 승인이 필요합니다.',
} as const satisfies Readonly<Record<PublishBlockedReason, string>>;

export function blockedReasonLabel(reason: string): string {
  const labels: Readonly<Record<string, string | undefined>> =
    BLOCKED_REASON_LABELS;
  return (
    labels[reason] ??
    '아직 공개 조건을 충족하지 않았습니다. 저장소 생성 상태·저장소 공개 예정 여부·프로그램 종료일·필수 마일스톤 승인을 확인해 주세요.'
  );
}

export function publishRepository(
  repositoryId: string,
): Promise<PublishRepositoryResponse> {
  return apiClient<PublishRepositoryResponse>(
    `repositories/${repositoryId}/publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isConfirmed: true }),
    },
  );
}
