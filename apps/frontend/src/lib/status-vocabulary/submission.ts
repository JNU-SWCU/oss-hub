import type { StatusBadgeVariantName } from './status-badge-variant';

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
