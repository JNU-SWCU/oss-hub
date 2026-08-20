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
  INVALID_REQUEST: 'MSD_019',
  SUBMISSION_FILE_NOT_FOUND: 'MSD_020',
  REVIEW_COMMENT_REQUIRED: 'MSD_021',
  SUBMISSION_NOT_FOUND: 'MSD_022',
  RESUBMISSION_NOT_ALLOWED: 'MSD_023',
  REVIEW_CHANGED: 'MSD_024',
  REVIEW_TARGET_CHANGED: 'MSD_025',
  ARCHIVE_TOO_LARGE: 'MSD_026',
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
    message:
      '제출된 서류가 있는 항목은 삭제하거나 제출 방식을 바꿀 수 없습니다.',
  },
  [MilestoneDocumentsErrorCode.INVALID_REQUEST]: {
    code: MilestoneDocumentsErrorCode.INVALID_REQUEST,
    status: 400,
    message: '요청 값을 확인해 주세요.',
  },
  [MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_NOT_FOUND,
    status: 404,
    message: '제출된 파일을 찾을 수 없습니다.',
  },
  [MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED]: {
    code: MilestoneDocumentsErrorCode.REVIEW_COMMENT_REQUIRED,
    status: 422,
    message: '보완 요청과 반려는 사유를 입력해 주세요.',
  },
  [MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND,
    status: 404,
    message: '제출된 서류를 찾을 수 없습니다.',
  },
  [MilestoneDocumentsErrorCode.RESUBMISSION_NOT_ALLOWED]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_NOT_ALLOWED,
    status: 409,
    message: '승인 또는 반려된 서류는 다시 제출할 수 없습니다.',
  },
  [MilestoneDocumentsErrorCode.REVIEW_CHANGED]: {
    code: MilestoneDocumentsErrorCode.REVIEW_CHANGED,
    status: 409,
    message:
      '제출하는 사이에 교직원 검토 결과가 등록되었습니다. 새로고침 후 다시 확인해 주세요.',
  },
  /**
   * 교직원이 **본 그 버전**이 아닌 것에 판정이 붙으려 했다 — 표를 그린 뒤 학생이 다시 냈거나
   * 다른 교직원이 먼저 판정했다.
   *
   * MSD_024(REVIEW_CHANGED)를 재사용하지 않는 이유는 **말 거는 상대와 사실이 다르기** 때문이다.
   * 024는 학생 제출 경로에서 「내는 사이에 판정이 등록되었다」를 학생에게 알린다. 여기서 막히는
   * 것은 교직원이고, 바뀐 것은 판정만이 아니라 **제출물 자체**일 수 있다. 같은 코드를 쓰면
   * 프런트가 두 화면에서 같은 문구를 띄우게 되어 「무엇이 바뀌었는지」가 사라진다.
   */
  [MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED]: {
    code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED,
    status: 409,
    message:
      '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
  },
  /**
   * 일괄 내려받기가 한 번에 흘려 보낼 수 있는 크기를 넘겼다.
   *
   * 413을 쓰는 이유: 요청 자체는 올바르고(404·422가 아니다) 서버도 멀쩡한데(5xx가 아니다)
   * **만들어질 응답 본문이 너무 크다**. 지금은 나눠 받을 길이 없어 문구로 안내만 한다 —
   * 실제로 이 값에 닿는 마일스톤이 생기면 서류 항목별 내려받기를 여는 것이 다음 수순이다.
   */
  [MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE]: {
    code: MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE,
    status: 413,
    message:
      '한 번에 내려받기에는 제출 파일이 너무 많습니다. 담당자에게 문의해 주세요.',
  },
};
