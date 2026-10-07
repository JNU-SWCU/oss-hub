import { ApiError } from '@/lib/api-client';
import { sanitizeDisplayText } from '@/lib/display-text';
import type {
  ApplicationDecisionAction,
  ApplicationListItem,
  ApplicationStatus,
  RepositoryProvisioningJobStatus,
} from './types';

export const APPLICATION_STATUS_LABELS: Readonly<
  Record<ApplicationStatus, string>
> = {
  SUBMITTED: '검토 대기',
  APPROVED: '승인',
  REJECTED: '반려',
};

export const APPLICATION_STATUS_BADGE: Readonly<
  Record<ApplicationStatus, 'pending' | 'approved' | 'rejected'>
> = {
  SUBMITTED: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export const NO_APPLICATION_LABEL = '신청 없음';

export const REVIEW_ACTION_LABEL = '검토하기';

export const PROVISIONING_LABELS: Readonly<
  Record<RepositoryProvisioningJobStatus, string>
> = {
  NOT_REQUESTED: '요청 전',
  DISABLED: '사용 안 함',
  PENDING: '대기 중',
  PROCESSING: '생성 중',
  SUCCEEDED: '생성 완료',
  RETRYABLE_FAILED: '재시도 대기',
  FAILED: '생성 실패',
  ANOMALOUS: '확인 필요',
};

export function isApplicationRevertBlocked(item: ApplicationListItem): boolean {
  return (
    item.status === 'APPROVED' &&
    item.repositoryConnectionMode === 'NEW' &&
    (item.repository !== null ||
      item.repositoryProvisioning.jobStatus === 'SUCCEEDED')
  );
}

export function formatSubmittedAt(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function displayAnswerText(value: string): string {
  return sanitizeDisplayText(value) ?? '';
}

export function displayApplicantName(item: ApplicationListItem): string {
  return (
    displayAnswerText(item.answers.applicantName) ||
    displayAnswerText(item.applicant.name ?? '') ||
    displayAnswerText(item.applicant.nickname)
  );
}

export function participationLabel(item: ApplicationListItem): string {
  if (item.team) {
    return `${item.team.name} (${item.team.memberCount}명)`;
  }
  return '1명';
}

export function staleApplicationDecisionTitle(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.problem.status === 404) return '신청이 이미 취소되었습니다';
  if (error.problem.status === 409) {
    if (isRevertBlockedDecisionError(error.problem)) {
      return '저장소가 이미 만들어진 승인은 반려로 바꿀 수 없습니다';
    }
    return '신청 상태가 변경되었습니다';
  }
  return null;
}

function isRevertBlockedDecisionError(problem: {
  readonly code: string;
}): boolean {
  if (problem.code === 'APP_023') return true;
  if (!('revertBlockedReason' in problem)) return false;
  return (
    typeof (problem as { readonly revertBlockedReason?: unknown })
      .revertBlockedReason === 'string'
  );
}

export function applicationDecisionTriggerId(
  action: ApplicationDecisionAction,
  applicationId?: string,
): string {
  const scope = applicationId === undefined ? '' : `-${applicationId}`;
  return `application-decision-${action.toLowerCase()}${scope}`;
}
