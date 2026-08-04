import type { ErrorCode } from '../common/error-code';

/** #619 마일스톤별 서류 항목(MilestoneDocument) 모듈 전용 에러 코드 레지스트리. */
export const MilestoneDocumentsErrorCode = {
  STAFF_ONLY: 'MSD_001',
  STUDENT_ONLY: 'MSD_002',
  MILESTONE_NOT_FOUND: 'MSD_003',
  DOCUMENT_NOT_FOUND: 'MSD_004',
  NOT_APPLICATION_MEMBER: 'MSD_005',
  APPLICATION_APPROVAL_REQUIRED: 'MSD_006',
  CONTENT_TYPE_MISMATCH: 'MSD_007',
  CONTENT_REQUIRED: 'MSD_008',
  INVALID_FILE_UPLOAD: 'MSD_009',
  UNSUPPORTED_FILE_TYPE: 'MSD_010',
  FILE_TOO_LARGE: 'MSD_011',
  FILE_STORAGE_UNAVAILABLE: 'MSD_012',
  FILE_RETENTION_UNAVAILABLE: 'MSD_013',
  PENDING_FILE_NOT_FOUND: 'MSD_014',
  TEMPLATE_NOT_FOUND: 'MSD_015',
  DOCUMENT_HAS_SUBMISSIONS: 'MSD_016',
  RELEASE_URL_NOT_LINKED_REPOSITORY: 'MSD_017',
  REPOSITORY_NOT_READY: 'MSD_018',
  INVALID_REQUEST: 'MSD_019',
} as const;

export type MilestoneDocumentsErrorCode =
  (typeof MilestoneDocumentsErrorCode)[keyof typeof MilestoneDocumentsErrorCode];

export const MILESTONE_DOCUMENTS_ERROR_CODES: Readonly<
  Record<MilestoneDocumentsErrorCode, ErrorCode>
> = {
  [MilestoneDocumentsErrorCode.STAFF_ONLY]: {
    code: MilestoneDocumentsErrorCode.STAFF_ONLY,
    status: 403,
    message: '승인된 교직원 또는 관리자만 사용할 수 있습니다.',
  },
  [MilestoneDocumentsErrorCode.STUDENT_ONLY]: {
    code: MilestoneDocumentsErrorCode.STUDENT_ONLY,
    status: 403,
    message: '승인된 학생 계정만 제출할 수 있습니다.',
  },
  [MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND,
    status: 404,
    message: '마일스톤을 찾을 수 없습니다.',
  },
  [MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND,
    status: 404,
    message: '서류 항목을 찾을 수 없습니다.',
  },
  [MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER]: {
    code: MilestoneDocumentsErrorCode.NOT_APPLICATION_MEMBER,
    status: 403,
    message: '해당 신청의 제출 권한이 없습니다.',
  },
  [MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED]: {
    code: MilestoneDocumentsErrorCode.APPLICATION_APPROVAL_REQUIRED,
    status: 403,
    message: '승인된 신청만 제출할 수 있습니다.',
  },
  [MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH]: {
    code: MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH,
    status: 422,
    message: '서류 항목에 지정된 제출 유형과 내용 유형이 다릅니다.',
  },
  [MilestoneDocumentsErrorCode.CONTENT_REQUIRED]: {
    code: MilestoneDocumentsErrorCode.CONTENT_REQUIRED,
    status: 422,
    message: '제출 내용을 입력해 주세요.',
  },
  [MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD]: {
    code: MilestoneDocumentsErrorCode.INVALID_FILE_UPLOAD,
    status: 400,
    message: '파일을 올바르게 입력해 주세요.',
  },
  [MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE]: {
    code: MilestoneDocumentsErrorCode.UNSUPPORTED_FILE_TYPE,
    status: 415,
    message: '지원하지 않는 파일 형식입니다.',
  },
  [MilestoneDocumentsErrorCode.FILE_TOO_LARGE]: {
    code: MilestoneDocumentsErrorCode.FILE_TOO_LARGE,
    status: 413,
    message: '파일 크기가 너무 큽니다.',
  },
  [MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE]: {
    code: MilestoneDocumentsErrorCode.FILE_STORAGE_UNAVAILABLE,
    status: 503,
    message: '파일 저장소를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  },
  [MilestoneDocumentsErrorCode.FILE_RETENTION_UNAVAILABLE]: {
    code: MilestoneDocumentsErrorCode.FILE_RETENTION_UNAVAILABLE,
    status: 422,
    message: '프로그램 종료일이 설정된 후 파일을 제출할 수 있습니다.',
  },
  [MilestoneDocumentsErrorCode.PENDING_FILE_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.PENDING_FILE_NOT_FOUND,
    status: 409,
    message: '업로드한 파일을 찾을 수 없거나 만료되었습니다. 다시 올려 주세요.',
  },
  [MilestoneDocumentsErrorCode.TEMPLATE_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.TEMPLATE_NOT_FOUND,
    status: 404,
    message: '등록된 양식 파일이 없습니다.',
  },
  [MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS]: {
    code: MilestoneDocumentsErrorCode.DOCUMENT_HAS_SUBMISSIONS,
    status: 409,
    message: '제출된 서류가 있는 항목은 삭제할 수 없습니다.',
  },
  [MilestoneDocumentsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY]: {
    code: MilestoneDocumentsErrorCode.RELEASE_URL_NOT_LINKED_REPOSITORY,
    status: 422,
    message: '연결된 저장소의 태그 또는 릴리스 URL을 입력해 주세요.',
  },
  [MilestoneDocumentsErrorCode.REPOSITORY_NOT_READY]: {
    code: MilestoneDocumentsErrorCode.REPOSITORY_NOT_READY,
    status: 409,
    message: '연결된 저장소가 아직 준비되지 않았습니다.',
  },
  [MilestoneDocumentsErrorCode.INVALID_REQUEST]: {
    code: MilestoneDocumentsErrorCode.INVALID_REQUEST,
    status: 400,
    message: '요청 값을 확인해 주세요.',
  },
};
