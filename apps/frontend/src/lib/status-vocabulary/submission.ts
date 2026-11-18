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

export type SubmissionDisplayStatus = SubmissionStatusKey | 'OVERDUE';
type StatusAudience = 'student' | 'staff';

export const SUBMISSION_DISPLAY_BADGE = {
  ...SUBMISSION_STATUS_BADGE,
  OVERDUE: 'rejected',
} as const satisfies Readonly<
  Record<SubmissionDisplayStatus, StatusBadgeVariantName>
>;

export function submissionStatusLabel(
  status: SubmissionDisplayStatus,
  audience: StatusAudience,
): string {
  if (status === 'OVERDUE') return '기한 지남';
  if (status === 'CHANGES_REQUESTED' && audience === 'student') {
    return '보완 필요';
  }
  return SUBMISSION_STATUS_LABELS[status];
}
