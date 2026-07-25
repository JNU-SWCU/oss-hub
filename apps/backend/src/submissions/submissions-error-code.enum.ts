import type { ErrorCode } from '../common/error-code';

export const SubmissionsErrorCode = {
  STUDENT_ONLY: 'SUB_001',
  MILESTONE_NOT_FOUND: 'SUB_002',
  NOT_APPLICATION_MEMBER: 'SUB_003',
  APPLICATION_APPROVAL_REQUIRED: 'SUB_004',
  SUBMISSION_ALREADY_EXISTS: 'SUB_005',
  MILESTONE_CLOSED: 'SUB_006',
  CONTENT_TYPE_MISMATCH: 'SUB_007',
  REPOSITORY_NOT_READY: 'SUB_008',
  RELEASE_URL_NOT_LINKED_REPOSITORY: 'SUB_009',
  FILE_SUBMISSION_UNAVAILABLE: 'SUB_010',
  CONTENT_REQUIRED: 'SUB_011',
  SUBMISSION_NOT_FOUND: 'SUB_012',
  RESUBMISSION_NOT_ALLOWED: 'SUB_013',
  STALE_SUBMISSION_REVISION: 'SUB_014',
} as const;

export type SubmissionsErrorCode =
  (typeof SubmissionsErrorCode)[keyof typeof SubmissionsErrorCode];

export const SUBMISSIONS_ERROR_CODES: Readonly<
  Record<SubmissionsErrorCode, ErrorCode>
> = {
  [SubmissionsErrorCode.STUDENT_ONLY]: {
    code: SubmissionsErrorCode.STUDENT_ONLY,
    status: 403,
    message: '승인된 학생 계정만 제출할 수 있습니다.',
  },
  [SubmissionsErrorCode.MILESTONE_NOT_FOUND]: {
    code: SubmissionsErrorCode.MILESTONE_NOT_FOUND,
    status: 404,
    message: '프로그램에 속한 마일스톤을 찾을 수 없습니다.',
  },
  [SubmissionsErrorCode.NOT_APPLICATION_MEMBER]: {
    code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER,
    status: 403,
    message: '해당 신청의 제출 권한이 없습니다.',
  },
  [SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED]: {
    code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED,
    status: 403,
    message: '승인된 신청만 제출할 수 있습니다.',
  },
  [SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS]: {
    code: SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS,
    status: 409,
    message: '이미 최초 제출이 존재합니다.',
  },
  [SubmissionsErrorCode.MILESTONE_CLOSED]: {
    code: SubmissionsErrorCode.MILESTONE_CLOSED,
    status: 422,
    message: '마감된 마일스톤에는 최초 제출할 수 없습니다.',
  },
  [SubmissionsErrorCode.CONTENT_TYPE_MISMATCH]: {
    code: SubmissionsErrorCode.CONTENT_TYPE_MISMATCH,
    status: 422,
    message: '마일스톤에 지정된 제출 유형과 내용 유형이 다릅니다.',
  },
  [SubmissionsErrorCode.REPOSITORY_NOT_READY]: {
    code: SubmissionsErrorCode.REPOSITORY_NOT_READY,
    status: 409,
    message: '연결된 저장소가 아직 준비되지 않았습니다.',
  },
  [SubmissionsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY]: {
    code: SubmissionsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY,
    status: 422,
    message: '연결된 저장소의 태그 또는 릴리스 URL을 입력해 주세요.',
  },
  [SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE]: {
    code: SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE,
    status: 422,
    message: '파일 제출은 비공개 저장소 준비 후 사용할 수 있습니다.',
  },
  [SubmissionsErrorCode.CONTENT_REQUIRED]: {
    code: SubmissionsErrorCode.CONTENT_REQUIRED,
    status: 422,
    message: '제출 내용을 입력해 주세요.',
  },
  [SubmissionsErrorCode.SUBMISSION_NOT_FOUND]: {
    code: SubmissionsErrorCode.SUBMISSION_NOT_FOUND,
    status: 404,
    message: '제출을 찾을 수 없습니다.',
  },
  [SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED]: {
    code: SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED,
    status: 409,
    message: '보완 요청(CHANGES_REQUESTED) 상태의 제출만 재제출할 수 있습니다.',
  },
  [SubmissionsErrorCode.STALE_SUBMISSION_REVISION]: {
    code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION,
    status: 409,
    message: '제출 상태가 갱신되었습니다. 최신 상태를 다시 불러와 주세요.',
  },
};
