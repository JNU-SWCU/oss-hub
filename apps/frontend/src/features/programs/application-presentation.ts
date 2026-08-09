import { ApiError } from '@/lib/api-client';
import type {
  ApplicationListItem,
  ApplicationStatus,
  RepositoryProvisioningJobStatus,
} from './types';

/**
 * 신청 한 건을 화면 글자로 옮기는 규칙. 목록(`program-applicants-page`)과 상세
 * (`program-application-detail-page`)가 **같은 것을 쓴다** — 같은 신청이 두 화면에서
 * 다른 낱말로 불리면 교직원이 다른 것으로 읽는다.
 */

export const APPLICATION_STATUS_LABELS: Readonly<
  Record<ApplicationStatus, string>
> = {
  SUBMITTED: '제출됨',
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

export function displayApplicantName(item: ApplicationListItem): string {
  return (
    item.answers.applicantName || item.applicant.name || item.applicant.nickname
  );
}

export function participationLabel(item: ApplicationListItem): string {
  if (item.team) {
    return `${item.team.name} (${item.team.memberCount}명)`;
  }
  return '1명';
}

/**
 * 판정 실패 중 "내가 보던 것이 이미 낡았다"에 해당하는 응답을 가려낸다.
 *
 * 409는 다른 운영자가 먼저 판정한 경우, 404(`APP_001`)는 학생이 먼저 취소한 경우다.
 * 원인은 다르지만 교직원이 취해야 할 행동은 같다 — 다시 불러와 최신 상태를 본다.
 * 404를 일반 오류로 흘리면 화면이 갱신되지 않아 이미 사라진 신청이 계속 대기 상태로
 * 남고, 다시 눌러도 같은 404가 반복된다.
 *
 * 프로비저닝이 끝난 승인 되돌리기(409 + `revertBlockedReason` / `APP_023`)도 같은
 * 경로로 처리한다. 다시 읽되, 내부 잠금 사유 문자열 대신 사람 말 안내를 쓴다.
 */
export function staleApplicationDecisionTitle(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.problem.status === 404) return '신청이 이미 취소되었습니다';
  if (error.problem.status === 409) {
    if (isRevertBlockedDecisionError(error.problem)) {
      return '저장소가 이미 만들어진 승인은 되돌릴 수 없습니다';
    }
    return '신청 상태가 변경되었습니다';
  }
  return null;
}

/** 백엔드 APP_023 — extensions에 `revertBlockedReason`이 실리거나 코드로 구분한다. */
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
