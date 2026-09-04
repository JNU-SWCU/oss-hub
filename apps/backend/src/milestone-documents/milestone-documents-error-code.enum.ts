import type { ErrorCode } from '../common/error-code';
import { SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE } from '../submissions/submission-upload-policy';

/** #619 마일스톤별 서류 항목(MilestoneDocument) 모듈 전용 에러 코드 레지스트리. */
export const MilestoneDocumentsErrorCode = {
  STAFF_ONLY: 'MSD_001',
  STUDENT_ONLY: 'MSD_002',
  MILESTONE_NOT_FOUND: 'MSD_003',
  DOCUMENT_NOT_FOUND: 'MSD_004',
  NOT_APPLICATION_MEMBER: 'MSD_005',
  APPLICATION_APPROVAL_REQUIRED: 'MSD_006',
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
  SUBMISSION_FILE_QUOTA_EXCEEDED: 'MSD_027',
  MILESTONE_CLOSED: 'MSD_028',
  SUBMISSION_REPLACEMENT_CLOSED: 'MSD_029',
  LAST_DOCUMENT_REQUIRED: 'MSD_030',
  RESUBMISSION_ALREADY_USED: 'MSD_031',
  RESUBMISSION_DUE_AT_REQUIRED: 'MSD_032',
  RESUBMISSION_DUE_AT_NOT_FUTURE: 'MSD_033',
  RESUBMISSION_DUE_AT_PASSED: 'MSD_034',
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
    /*
     * 상한 숫자가 없는 「파일 크기가 너무 큽니다.」로는 학생이 무엇을 줄여야 하는지
     * 알 수 없었다(#1107). 화면이 파일을 고르기 전에 보여 주는 문구와 **같은 문장**을
     * 쓴다 — 미리 걸러졌든 서버가 413으로 거절했든 읽는 말이 같아야 한다.
     */
    message: SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE,
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
      '제출 이력이 있는 항목은 삭제할 수 없습니다. 항목은 유지하고 이름이나 필수 여부를 수정해 주세요.',
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
  /**
   * 한 사람이 보관할 수 있는 제출 파일 개수·총 바이트를 넘겼다. 제출물 경로의
   * SUB_024와 같은 판정이다 — 둘은 같은 SubmissionFile 테이블을 채우므로 모듈마다
   * 다른 한도를 두면 쓸모 없는 경로 하나만 골라 한도를 우회할 수 있게 된다.
   */
  [MilestoneDocumentsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED]: {
    code: MilestoneDocumentsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED,
    status: 413,
    message: '보관 중인 제출 파일 한도를 초과했습니다.',
  },
  [MilestoneDocumentsErrorCode.MILESTONE_CLOSED]: {
    code: MilestoneDocumentsErrorCode.MILESTONE_CLOSED,
    status: 422,
    message:
      '마감된 마일스톤입니다. 일정 변경이 필요한 경우 담당 교직원에게 문의해 주세요.',
  },
  [MilestoneDocumentsErrorCode.SUBMISSION_REPLACEMENT_CLOSED]: {
    code: MilestoneDocumentsErrorCode.SUBMISSION_REPLACEMENT_CLOSED,
    status: 422,
    message:
      '마감 이후에는 검토 전 제출을 바꿀 수 없습니다. 보완 요청을 받은 경우 다시 제출할 수 있습니다.',
  },
  [MilestoneDocumentsErrorCode.LAST_DOCUMENT_REQUIRED]: {
    code: MilestoneDocumentsErrorCode.LAST_DOCUMENT_REQUIRED,
    status: 409,
    message:
      '마일스톤에는 제출 항목이 하나 이상 필요합니다. 새 항목을 만든 뒤 기존 항목을 삭제해 주세요.',
  },
  /**
   * 마감 뒤 보완 요청이 열어 준 재제출을 **이미 한 번 썼다** — 지금은 교직원 검토를 기다리는
   * 자리다(#1097에서 정한 규칙: 재제출은 한 번, 검토 중에는 내용이 바뀌지 않는다).
   *
   * MSD_029(SUBMISSION_REPLACEMENT_CLOSED)를 재사용하지 않는 이유는 **그 문구가 여기서
   * 거짓말이 되기** 때문이다. 029는 「보완 요청을 받은 경우 다시 제출할 수 있습니다」로 끝나는데,
   * 여기서 막힌 학생은 이미 보완 요청을 받아 다시 낸 사람이다 — 그 문장을 그대로 보여 주면
   * 「받았는데 왜 안 되지」가 되어 이 티켓이 없애려던 문의가 그대로 남는다.
   *
   * MSD_023(RESUBMISSION_NOT_ALLOWED, 409)이 아니라 마감 창 계열(422)에 두는 이유: 이 막힘을
   * 만드는 것은 판정이 아니라 **마감**이다. 같은 상태라도 마감 전에는 그대로 낼 수 있다.
   */
  [MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED,
    status: 422,
    message:
      '보완 요청에 응해 이미 다시 제출했습니다. 마감 이후에는 검토 결과가 나올 때까지 내용을 바꿀 수 없습니다.',
  },
  /**
   * 보완 요청인데 재제출 기한이 없다. 화면(판정 패널)이 먼저 막으므로 여기까지 오면 검증이
   * 새어 나간 것이다 — 사유 필수(MSD_021)와 같은 자리·같은 성격의 거절이다.
   *
   * 승인·반려에는 이 검사가 없다. 그 둘은 「다시 내라」가 아니므로 기한이라는 것 자체가 없다.
   */
  [MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED,
    status: 422,
    message: '보완 요청은 재제출 기한을 정해야 합니다.',
  },
  /**
   * 지난 시각을 재제출 기한으로 잡았다. 막지 않으면 보완 요청이 저장되는 순간 이미 닫혀 있어
   * **「다시 내세요」가 실제로는 반려**가 된다 — 학생은 요청을 받고도 낼 수 없고, 화면에는
   * 아무 잘못도 보이지 않는다.
   *
   * 판정 시각은 잠금을 얻은 뒤에 찍히므로(`milestone-document-reviews.service.ts`) 이 비교도
   * 그 시각으로 한다. 요청이 들어온 시각으로 재면 잠금을 오래 기다린 판정이 「미래」로
   * 통과한 뒤 저장 시점에는 이미 지나 있을 수 있다.
   */
  [MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE,
    status: 422,
    message: '재제출 기한은 지금보다 뒤여야 합니다.',
  },
  /**
   * 교직원이 정한 재제출 기한이 지났다.
   *
   * 앞의 세 마감 코드를 재사용하지 않는 이유는 전부 **여기서 사실이 아니기** 때문이다.
   * MSD_028은 「마감된 마일스톤입니다」라 재제출 창이 있었다는 사실을 지우고, MSD_029는
   * 「보완 요청을 받은 경우 다시 제출할 수 있습니다」로 끝나 지금 막힌 이유와 정면으로
   * 어긋나며, MSD_031은 「이미 다시 제출했습니다」인데 이 학생은 한 번도 응하지 않았다.
   */
  [MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_PASSED]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_PASSED,
    status: 422,
    message:
      '교직원이 정한 재제출 기한이 지났습니다. 기한 연장이 필요하면 담당 교직원에게 문의해 주세요.',
  },
};
