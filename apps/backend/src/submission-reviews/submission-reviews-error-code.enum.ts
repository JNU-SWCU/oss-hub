import type { ErrorCode } from '../common/error-code';

export const SubmissionReviewsErrorCode = {
  SUBMISSION_NOT_FOUND: 'SUB_001',
  STAFF_APPROVAL_REQUIRED: 'SUB_002',
  STALE_REVISION: 'SUB_003',
  ALREADY_REVIEWED: 'SUB_004',
  COMMENT_REQUIRED: 'SUB_005',
  REPOSITORY_NOT_READY: 'SUB_006',
  REQUIRED_MILESTONES_NOT_APPROVED: 'SUB_007',
  GITHUB_PUBLISH_FAILED: 'SUB_008',
} as const;

export type SubmissionReviewsErrorCode =
  (typeof SubmissionReviewsErrorCode)[keyof typeof SubmissionReviewsErrorCode];

export const SUBMISSION_REVIEWS_ERROR_CODES: Record<
  SubmissionReviewsErrorCode,
  ErrorCode
> = {
  [SubmissionReviewsErrorCode.SUBMISSION_NOT_FOUND]: {
    code: SubmissionReviewsErrorCode.SUBMISSION_NOT_FOUND,
    status: 404,
    message: '제출을 찾을 수 없습니다.',
  },
  [SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED]: {
    code: SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED,
    status: 403,
    message: '승인된 교직원 또는 관리자만 제출을 검토할 수 있습니다.',
  },
  [SubmissionReviewsErrorCode.STALE_REVISION]: {
    code: SubmissionReviewsErrorCode.STALE_REVISION,
    status: 409,
    message: '최신 제출 revision을 다시 불러와 주세요.',
  },
  [SubmissionReviewsErrorCode.ALREADY_REVIEWED]: {
    code: SubmissionReviewsErrorCode.ALREADY_REVIEWED,
    status: 409,
    message: '이미 판정된 제출 revision입니다.',
  },
  [SubmissionReviewsErrorCode.COMMENT_REQUIRED]: {
    code: SubmissionReviewsErrorCode.COMMENT_REQUIRED,
    status: 422,
    message: '보완 요청과 최종 반려에는 코멘트가 필요합니다.',
  },
  [SubmissionReviewsErrorCode.REPOSITORY_NOT_READY]: {
    code: SubmissionReviewsErrorCode.REPOSITORY_NOT_READY,
    status: 409,
    message: '저장소가 공개 전환할 준비가 되지 않았습니다.',
  },
  [SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED]: {
    code: SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED,
    status: 409,
    message: '모든 필수 마일스톤을 먼저 승인해 주세요.',
  },
  [SubmissionReviewsErrorCode.GITHUB_PUBLISH_FAILED]: {
    code: SubmissionReviewsErrorCode.GITHUB_PUBLISH_FAILED,
    status: 502,
    message: 'GitHub 저장소 공개 전환에 실패했습니다.',
    exposeToClient: true,
  },
};
