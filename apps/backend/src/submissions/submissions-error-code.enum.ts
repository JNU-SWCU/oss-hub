import type { ErrorCode } from '../common/error-code';

export const SubmissionsErrorCode = {
  STUDENT_ONLY: 'SUB_001',
  MILESTONE_NOT_FOUND: 'SUB_002',
  NOT_APPLICATION_MEMBER: 'SUB_003',
  APPLICATION_APPROVAL_REQUIRED: 'SUB_004',
  SUBMISSION_ALREADY_EXISTS: 'SUB_005',
  MILESTONE_CLOSED: 'SUB_006',
  CONTENT_TYPE_MISMATCH: 'SUB_007',
  FILE_SUBMISSION_UNAVAILABLE: 'SUB_010',
  CONTENT_REQUIRED: 'SUB_011',
  SUBMISSION_NOT_FOUND: 'SUB_012',
  RESUBMISSION_NOT_ALLOWED: 'SUB_013',
  STALE_SUBMISSION_REVISION: 'SUB_014',
  STAFF_ONLY: 'SUB_015',
  PROGRAM_NOT_FOUND: 'SUB_016',
  INVALID_FILE_UPLOAD: 'SUB_017',
  UNSUPPORTED_FILE_TYPE: 'SUB_018',
  FILE_TOO_LARGE: 'SUB_019',
  FILE_STORAGE_UNAVAILABLE: 'SUB_020',
  FILE_RETENTION_UNAVAILABLE: 'SUB_021',
  SUBMISSION_FILE_NOT_FOUND: 'SUB_022',
  SUBMISSION_REPLACEMENT_CLOSED: 'SUB_023',
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
  [SubmissionsErrorCode.STAFF_ONLY]: {
    code: SubmissionsErrorCode.STAFF_ONLY,
    status: 403,
    message: '승인된 교직원 또는 관리자만 제출 현황을 조회할 수 있습니다.',
  },
  [SubmissionsErrorCode.PROGRAM_NOT_FOUND]: {
    code: SubmissionsErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message: '프로그램을 찾을 수 없습니다.',
  },
  [SubmissionsErrorCode.INVALID_FILE_UPLOAD]: {
    code: SubmissionsErrorCode.INVALID_FILE_UPLOAD,
    status: 400,
    message: '파일, 신청 ID, 마일스톤 ID를 올바르게 입력해 주세요.',
  },
  [SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE]: {
    code: SubmissionsErrorCode.UNSUPPORTED_FILE_TYPE,
    status: 415,
    message: '지원하지 않는 파일 형식입니다.',
  },
  [SubmissionsErrorCode.FILE_TOO_LARGE]: {
    code: SubmissionsErrorCode.FILE_TOO_LARGE,
    status: 413,
    message: '파일 크기는 50 MiB를 초과할 수 없습니다.',
  },
  [SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE]: {
    code: SubmissionsErrorCode.FILE_STORAGE_UNAVAILABLE,
    status: 503,
    message: '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  },
  [SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE]: {
    code: SubmissionsErrorCode.FILE_RETENTION_UNAVAILABLE,
    status: 422,
    message: '프로그램 종료일이 설정된 후 파일을 제출할 수 있습니다.',
  },
  [SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND]: {
    code: SubmissionsErrorCode.SUBMISSION_FILE_NOT_FOUND,
    status: 404,
    message: '파일을 찾을 수 없습니다.',
  },
  [SubmissionsErrorCode.SUBMISSION_REPLACEMENT_CLOSED]: {
    code: SubmissionsErrorCode.SUBMISSION_REPLACEMENT_CLOSED,
    status: 422,
    message: '마감된 마일스톤의 제출물은 교체할 수 없습니다.',
  },
};
