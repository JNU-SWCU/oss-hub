import type { StatusBadgeVariantName } from './status-badge-variant';

/**
 * 제출(마일스톤 서류) 상태의 단일 원본 — 라벨과 배지 변형(R-35).
 *
 * 학생 대시보드·프로그램 상세·제출 체크리스트·교직원 서류 판정 화면이 같은 제출을
 * 같은 말로 부른다. 2026-09-19 결정(#1295): 교직원 서류 판정 화면의 말을 학생 화면
 * 전체에 쓴다. 이전에는 「제출 전·제출됨·보완 필요·최종 반려」와 「검토 중·승인 완료·
 * 수정 요청」이 같은 상태를 달리 불렀다.
 *
 * 배지 색은 교직원 수합 표의 근거를 따른다 — 검토 대기(진행 중, 중립)와 보완 요청
 * (학생이 할 일, 주의)을 같은 색으로 묶지 않는다. 붉은색은 반려 하나다.
 */
export type SubmissionStatusKey =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export const SUBMISSION_STATUS_LABELS = {
  NOT_SUBMITTED: '미제출',
  SUBMITTED: '검토 대기',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 요청',
  REJECTED: '반려',
} as const satisfies Readonly<Record<SubmissionStatusKey, string>>;

export const SUBMISSION_STATUS_BADGE = {
  NOT_SUBMITTED: 'closed',
  SUBMITTED: 'recruiting',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'pending',
  REJECTED: 'rejected',
} as const satisfies Readonly<
  Record<SubmissionStatusKey, StatusBadgeVariantName>
>;
