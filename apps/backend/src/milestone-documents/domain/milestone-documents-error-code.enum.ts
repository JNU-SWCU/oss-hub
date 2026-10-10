import type { ErrorCode } from '../../common/error-code';
import { SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE } from '../../submissions/domain/submission-upload-policy';
import {
  SUBMISSION_ZIP_REJECTION_MESSAGES,
  SubmissionZipRejection,
} from '../../submissions/domain/submission-zip-admission';

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
  PROGRAM_NOT_FOUND: 'MSD_035',
  ARCHIVE_TEAM_NOT_FOUND: 'MSD_036',

  ZIP_UNREADABLE: 'MSD_037',
  ZIP_ENTRY_NOT_ALLOWED: 'MSD_038',
  ZIP_NESTED: 'MSD_039',
  ZIP_PASSWORD_PROTECTED: 'MSD_040',
  ZIP_UNSUPPORTED_COMPRESSION: 'MSD_041',
  ZIP_TOO_MANY_ENTRIES: 'MSD_042',
  ZIP_CONTENT_TOO_LARGE: 'MSD_043',
  ZIP_EXPANDS_TOO_MUCH: 'MSD_044',
} as const;

export type MilestoneDocumentsErrorCode =
  (typeof MilestoneDocumentsErrorCode)[keyof typeof MilestoneDocumentsErrorCode];

export const MILESTONE_DOCUMENTS_ERROR_CODES: Readonly<
  Record<MilestoneDocumentsErrorCode, ErrorCode>
> = {
  [MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message:
      '프로그램을 찾을 수 없습니다. 프로그램 목록에서 다시 선택해 주세요.',
  },
  [MilestoneDocumentsErrorCode.ARCHIVE_TEAM_NOT_FOUND]: {
    code: MilestoneDocumentsErrorCode.ARCHIVE_TEAM_NOT_FOUND,
    status: 404,
    message:
      '이 프로그램의 승인된 팀을 찾을 수 없습니다. 다운로드할 팀을 다시 선택해 주세요.',
  },
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

  [MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED]: {
    code: MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED,
    status: 409,
    message:
      '검토하는 사이에 제출물 또는 검토 결과가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
  },

  [MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE]: {
    code: MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE,
    status: 413,
    message:
      '한 번에 내려받기에는 제출 파일이 너무 많습니다. 담당자에게 문의해 주세요.',
  },

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

  [MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_ALREADY_USED,
    status: 422,
    message:
      '보완 요청에 응해 이미 다시 제출했습니다. 마감 이후에는 검토 결과가 나올 때까지 내용을 바꿀 수 없습니다.',
  },

  [MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_REQUIRED,
    status: 422,
    message: '보완 요청은 재제출 기한을 정해야 합니다.',
  },

  [MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_NOT_FUTURE,
    status: 422,
    message: '재제출 기한은 지금보다 뒤여야 합니다.',
  },

  [MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_PASSED]: {
    code: MilestoneDocumentsErrorCode.RESUBMISSION_DUE_AT_PASSED,
    status: 422,
    message:
      '교직원이 정한 재제출 기한이 지났습니다. 기한 연장이 필요하면 담당 교직원에게 문의해 주세요.',
  },

  [MilestoneDocumentsErrorCode.ZIP_UNREADABLE]: {
    code: MilestoneDocumentsErrorCode.ZIP_UNREADABLE,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[SubmissionZipRejection.UNREADABLE],
  },
  [MilestoneDocumentsErrorCode.ZIP_ENTRY_NOT_ALLOWED]: {
    code: MilestoneDocumentsErrorCode.ZIP_ENTRY_NOT_ALLOWED,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.ENTRY_NOT_ALLOWED
      ],
  },
  [MilestoneDocumentsErrorCode.ZIP_NESTED]: {
    code: MilestoneDocumentsErrorCode.ZIP_NESTED,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[SubmissionZipRejection.NESTED_ARCHIVE],
  },
  [MilestoneDocumentsErrorCode.ZIP_PASSWORD_PROTECTED]: {
    code: MilestoneDocumentsErrorCode.ZIP_PASSWORD_PROTECTED,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.PASSWORD_PROTECTED
      ],
  },
  [MilestoneDocumentsErrorCode.ZIP_UNSUPPORTED_COMPRESSION]: {
    code: MilestoneDocumentsErrorCode.ZIP_UNSUPPORTED_COMPRESSION,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.UNSUPPORTED_COMPRESSION
      ],
  },
  [MilestoneDocumentsErrorCode.ZIP_TOO_MANY_ENTRIES]: {
    code: MilestoneDocumentsErrorCode.ZIP_TOO_MANY_ENTRIES,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.TOO_MANY_ENTRIES
      ],
  },
  [MilestoneDocumentsErrorCode.ZIP_CONTENT_TOO_LARGE]: {
    code: MilestoneDocumentsErrorCode.ZIP_CONTENT_TOO_LARGE,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.CONTENT_TOO_LARGE
      ],
  },
  [MilestoneDocumentsErrorCode.ZIP_EXPANDS_TOO_MUCH]: {
    code: MilestoneDocumentsErrorCode.ZIP_EXPANDS_TOO_MUCH,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.EXPANDS_TOO_MUCH
      ],
  },
};

export const MILESTONE_DOCUMENT_ZIP_REJECTION_ERROR_CODES: Readonly<
  Record<SubmissionZipRejection, MilestoneDocumentsErrorCode>
> = {
  [SubmissionZipRejection.UNREADABLE]:
    MilestoneDocumentsErrorCode.ZIP_UNREADABLE,
  [SubmissionZipRejection.ENTRY_NOT_ALLOWED]:
    MilestoneDocumentsErrorCode.ZIP_ENTRY_NOT_ALLOWED,
  [SubmissionZipRejection.NESTED_ARCHIVE]:
    MilestoneDocumentsErrorCode.ZIP_NESTED,
  [SubmissionZipRejection.PASSWORD_PROTECTED]:
    MilestoneDocumentsErrorCode.ZIP_PASSWORD_PROTECTED,
  [SubmissionZipRejection.UNSUPPORTED_COMPRESSION]:
    MilestoneDocumentsErrorCode.ZIP_UNSUPPORTED_COMPRESSION,
  [SubmissionZipRejection.TOO_MANY_ENTRIES]:
    MilestoneDocumentsErrorCode.ZIP_TOO_MANY_ENTRIES,
  [SubmissionZipRejection.CONTENT_TOO_LARGE]:
    MilestoneDocumentsErrorCode.ZIP_CONTENT_TOO_LARGE,
  [SubmissionZipRejection.EXPANDS_TOO_MUCH]:
    MilestoneDocumentsErrorCode.ZIP_EXPANDS_TOO_MUCH,
};
