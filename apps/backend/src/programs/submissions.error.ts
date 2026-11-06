import type { ErrorCode } from '../platform/error-code.error';
import { SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE } from './submission-upload.config';
export const SubmissionReviewsErrorCode = {
  SELF_REVIEW_FORBIDDEN: 'SUB_033',
  SUBMISSION_NOT_FOUND: 'SUB_001',
  STAFF_APPROVAL_REQUIRED: 'SUB_002',
  STALE_REVISION: 'SUB_003',
  ALREADY_REVIEWED: 'SUB_004',
  REPOSITORY_NOT_READY: 'SUB_006',
  REQUIRED_MILESTONES_NOT_APPROVED: 'SUB_007',
  GITHUB_PUBLISH_FAILED: 'SUB_008',
  REPOSITORY_PUBLICATION_NOT_PLANNED: 'SUB_009',
  PROGRAM_NOT_ENDED: 'SUB_010',
  PUBLISH_CONFIRMATION_REQUIRED: 'SUB_011',
} as const;

export type SubmissionReviewsErrorCode =
  (typeof SubmissionReviewsErrorCode)[keyof typeof SubmissionReviewsErrorCode];

export const SUBMISSION_REVIEWS_ERROR_CODES: Record<
  SubmissionReviewsErrorCode,
  ErrorCode
> = {
  [SubmissionReviewsErrorCode.SELF_REVIEW_FORBIDDEN]: {
    code: SubmissionReviewsErrorCode.SELF_REVIEW_FORBIDDEN,
    status: 403,
    message:
      '자기 팀 서류는 검토할 수 없습니다. 다른 교직원이나 운영자에게 검토를 요청해 주세요.',
  },
  [SubmissionReviewsErrorCode.SUBMISSION_NOT_FOUND]: {
    code: SubmissionReviewsErrorCode.SUBMISSION_NOT_FOUND,
    status: 404,
    message: '제출을 찾을 수 없습니다.',
  },
  [SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED]: {
    code: SubmissionReviewsErrorCode.STAFF_APPROVAL_REQUIRED,
    status: 403,
    message: '승인된 교직원만 제출을 검토할 수 있습니다.',
  },
  [SubmissionReviewsErrorCode.STALE_REVISION]: {
    code: SubmissionReviewsErrorCode.STALE_REVISION,
    status: 409,
    message: '최신 제출 revision을 다시 불러와 주세요.',
  },
  [SubmissionReviewsErrorCode.ALREADY_REVIEWED]: {
    code: SubmissionReviewsErrorCode.ALREADY_REVIEWED,
    status: 409,
    message: '이미 검토가 끝난 제출본입니다.',
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
  [SubmissionReviewsErrorCode.REPOSITORY_PUBLICATION_NOT_PLANNED]: {
    code: SubmissionReviewsErrorCode.REPOSITORY_PUBLICATION_NOT_PLANNED,
    status: 409,

    message: '이 신청은 저장소 공개가 계획되어 있지 않습니다.',
  },
  [SubmissionReviewsErrorCode.PROGRAM_NOT_ENDED]: {
    code: SubmissionReviewsErrorCode.PROGRAM_NOT_ENDED,
    status: 409,
    message: '프로그램이 아직 종료되지 않아 공개할 수 없습니다.',
  },
  [SubmissionReviewsErrorCode.PUBLISH_CONFIRMATION_REQUIRED]: {
    code: SubmissionReviewsErrorCode.PUBLISH_CONFIRMATION_REQUIRED,
    status: 422,
    message: '공개 전환에는 명시적 확인이 필요합니다.',
  },
};
export class InvalidMilestoneDocumentHistoryCursorError extends Error {
  override readonly name = 'InvalidMilestoneDocumentHistoryCursorError';
}
export class MilestoneDocumentArchiveEntryError extends Error {
  override readonly name = 'MilestoneDocumentArchiveEntryError';

  constructor(
    readonly storageKey: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
export class MilestoneDocumentPendingFileMissingError extends Error {
  override readonly name = 'MilestoneDocumentPendingFileMissingError';
}

export class MilestoneDocumentReviewChangedError extends Error {
  override readonly name = 'MilestoneDocumentReviewChangedError';
}

export class MilestoneDocumentDeadlineClosedError extends Error {
  override readonly name = 'MilestoneDocumentDeadlineClosedError';
}

export class MilestoneDocumentSubmissionChangedError extends Error {
  override readonly name = 'MilestoneDocumentSubmissionChangedError';
}

export class MilestoneDocumentRevisionChangedError extends Error {
  override readonly name = 'MilestoneDocumentRevisionChangedError';
}

export class MilestoneDocumentMissingError extends Error {
  override readonly name = 'MilestoneDocumentMissingError';
}
export class UnexpectedSubmissionStatusError extends Error {
  override readonly name = 'UnexpectedSubmissionStatusError';
}
export class SubmissionMembershipChangedError extends Error {
  override readonly name = 'SubmissionMembershipChangedError';

  constructor(
    readonly teamId: string,
    readonly userId: string,
  ) {
    super('제출 권한이 트랜잭션 도중 사라졌습니다.');
  }
}
export class SubmissionRevisionInvariantError extends Error {
  override readonly name = 'SubmissionRevisionInvariantError';
}
export const MAX_ENTRY_COUNT = 1_000;

export const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

export const SubmissionZipRejection = {
  UNREADABLE: 'UNREADABLE',

  ENTRY_NOT_ALLOWED: 'ENTRY_NOT_ALLOWED',

  NESTED_ARCHIVE: 'NESTED_ARCHIVE',

  PASSWORD_PROTECTED: 'PASSWORD_PROTECTED',

  UNSUPPORTED_COMPRESSION: 'UNSUPPORTED_COMPRESSION',

  TOO_MANY_ENTRIES: 'TOO_MANY_ENTRIES',

  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',

  EXPANDS_TOO_MUCH: 'EXPANDS_TOO_MUCH',
} as const;

export type SubmissionZipRejection =
  (typeof SubmissionZipRejection)[keyof typeof SubmissionZipRejection];

export const SUBMISSION_ZIP_REJECTION_MESSAGES: Readonly<
  Record<SubmissionZipRejection, string>
> = {
  [SubmissionZipRejection.UNREADABLE]:
    '압축 파일을 열 수 없습니다. 파일이 손상되지 않았는지 확인하고 다시 압축해 제출해 주세요.',
  [SubmissionZipRejection.ENTRY_NOT_ALLOWED]:
    '압축 파일에 담을 수 없는 항목이 있습니다. 바로가기 대신 실제 파일만 담아 다시 압축해 주세요.',
  [SubmissionZipRejection.NESTED_ARCHIVE]:
    '압축 파일 안에 또 다른 압축 파일이 있습니다. 안쪽 압축을 풀고 다시 압축해 주세요.',
  [SubmissionZipRejection.PASSWORD_PROTECTED]:
    '비밀번호가 걸린 압축 파일은 제출할 수 없습니다. 비밀번호 없이 다시 압축해 주세요.',
  [SubmissionZipRejection.UNSUPPORTED_COMPRESSION]:
    '이 압축 방식은 제출할 수 없습니다. 컴퓨터에 기본으로 있는 압축 기능으로 다시 압축해 주세요.',
  [SubmissionZipRejection.TOO_MANY_ENTRIES]: `압축 파일에 담긴 파일이 너무 많습니다. ${MAX_ENTRY_COUNT.toLocaleString('en-US')}개 이하로 줄여 다시 압축해 주세요.`,
  [SubmissionZipRejection.CONTENT_TOO_LARGE]: `압축을 풀었을 때의 크기가 너무 큽니다. 파일 하나는 ${MAX_ENTRY_UNCOMPRESSED_BYTES / 1024 / 1024} MB, 전체는 ${MAX_TOTAL_UNCOMPRESSED_BYTES / 1024 / 1024} MB 이하가 되도록 줄여 주세요.`,
  [SubmissionZipRejection.EXPANDS_TOO_MUCH]:
    '압축을 풀면 크기가 지나치게 불어나는 파일이 들어 있습니다. 그 파일을 빼고 다시 압축하거나 담당 교직원에게 문의해 주세요.',
};
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
  SUBMISSION_FILE_QUOTA_EXCEEDED: 'SUB_024',

  ZIP_UNREADABLE: 'SUB_025',
  ZIP_ENTRY_NOT_ALLOWED: 'SUB_026',
  ZIP_NESTED: 'SUB_027',
  ZIP_PASSWORD_PROTECTED: 'SUB_028',
  ZIP_UNSUPPORTED_COMPRESSION: 'SUB_029',
  ZIP_TOO_MANY_ENTRIES: 'SUB_030',
  ZIP_CONTENT_TOO_LARGE: 'SUB_031',
  ZIP_EXPANDS_TOO_MUCH: 'SUB_032',
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
    message: '승인된 교직원만 제출 현황을 조회할 수 있습니다.',
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

    message: SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE,
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
  [SubmissionsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED]: {
    code: SubmissionsErrorCode.SUBMISSION_FILE_QUOTA_EXCEEDED,
    status: 413,
    message: '보관 중인 제출 파일 한도를 초과했습니다.',
  },

  [SubmissionsErrorCode.ZIP_UNREADABLE]: {
    code: SubmissionsErrorCode.ZIP_UNREADABLE,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[SubmissionZipRejection.UNREADABLE],
  },
  [SubmissionsErrorCode.ZIP_ENTRY_NOT_ALLOWED]: {
    code: SubmissionsErrorCode.ZIP_ENTRY_NOT_ALLOWED,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.ENTRY_NOT_ALLOWED
      ],
  },
  [SubmissionsErrorCode.ZIP_NESTED]: {
    code: SubmissionsErrorCode.ZIP_NESTED,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[SubmissionZipRejection.NESTED_ARCHIVE],
  },
  [SubmissionsErrorCode.ZIP_PASSWORD_PROTECTED]: {
    code: SubmissionsErrorCode.ZIP_PASSWORD_PROTECTED,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.PASSWORD_PROTECTED
      ],
  },
  [SubmissionsErrorCode.ZIP_UNSUPPORTED_COMPRESSION]: {
    code: SubmissionsErrorCode.ZIP_UNSUPPORTED_COMPRESSION,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.UNSUPPORTED_COMPRESSION
      ],
  },
  [SubmissionsErrorCode.ZIP_TOO_MANY_ENTRIES]: {
    code: SubmissionsErrorCode.ZIP_TOO_MANY_ENTRIES,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.TOO_MANY_ENTRIES
      ],
  },
  [SubmissionsErrorCode.ZIP_CONTENT_TOO_LARGE]: {
    code: SubmissionsErrorCode.ZIP_CONTENT_TOO_LARGE,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.CONTENT_TOO_LARGE
      ],
  },
  [SubmissionsErrorCode.ZIP_EXPANDS_TOO_MUCH]: {
    code: SubmissionsErrorCode.ZIP_EXPANDS_TOO_MUCH,
    status: 422,
    message:
      SUBMISSION_ZIP_REJECTION_MESSAGES[
        SubmissionZipRejection.EXPANDS_TOO_MUCH
      ],
  },
};

export const SUBMISSION_ZIP_REJECTION_ERROR_CODES: Readonly<
  Record<SubmissionZipRejection, SubmissionsErrorCode>
> = {
  [SubmissionZipRejection.UNREADABLE]: SubmissionsErrorCode.ZIP_UNREADABLE,
  [SubmissionZipRejection.ENTRY_NOT_ALLOWED]:
    SubmissionsErrorCode.ZIP_ENTRY_NOT_ALLOWED,
  [SubmissionZipRejection.NESTED_ARCHIVE]: SubmissionsErrorCode.ZIP_NESTED,
  [SubmissionZipRejection.PASSWORD_PROTECTED]:
    SubmissionsErrorCode.ZIP_PASSWORD_PROTECTED,
  [SubmissionZipRejection.UNSUPPORTED_COMPRESSION]:
    SubmissionsErrorCode.ZIP_UNSUPPORTED_COMPRESSION,
  [SubmissionZipRejection.TOO_MANY_ENTRIES]:
    SubmissionsErrorCode.ZIP_TOO_MANY_ENTRIES,
  [SubmissionZipRejection.CONTENT_TOO_LARGE]:
    SubmissionsErrorCode.ZIP_CONTENT_TOO_LARGE,
  [SubmissionZipRejection.EXPANDS_TOO_MUCH]:
    SubmissionsErrorCode.ZIP_EXPANDS_TOO_MUCH,
};
export const MilestoneDocumentsErrorCode = {
  SELF_REVIEW_FORBIDDEN: 'MSD_046',
  STAFF_ONLY: 'MSD_001',
  STUDENT_ONLY: 'MSD_002',
  MILESTONE_NOT_FOUND: 'MSD_003',
  DOCUMENT_NOT_FOUND: 'MSD_004',
  NOT_APPLICATION_MEMBER: 'MSD_005',
  APPLICATION_APPROVAL_REQUIRED: 'MSD_006',
  CONTENT_REQUIRED: 'MSD_008',
  CONTENT_TYPE_MISMATCH: 'MSD_047',
  SUBMISSION_REVISION_CHANGED: 'MSD_048',
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
  INVALID_GRACE_DUE_AT: 'MSD_045',
} as const;

export type MilestoneDocumentsErrorCode =
  (typeof MilestoneDocumentsErrorCode)[keyof typeof MilestoneDocumentsErrorCode];

export const MILESTONE_DOCUMENTS_ERROR_CODES: Readonly<
  Record<MilestoneDocumentsErrorCode, ErrorCode>
> = {
  [MilestoneDocumentsErrorCode.SUBMISSION_REVISION_CHANGED]: {
    code: MilestoneDocumentsErrorCode.SUBMISSION_REVISION_CHANGED,
    status: 409,
    message:
      '제출본이 변경되었습니다. 최신 제출 내역을 확인한 뒤 다시 제출해 주세요.',
  },
  [MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH]: {
    code: MilestoneDocumentsErrorCode.CONTENT_TYPE_MISMATCH,
    status: 422,
    message: '이 항목의 제출 형식에 맞는 내용을 입력해 주세요.',
  },
  [MilestoneDocumentsErrorCode.INVALID_GRACE_DUE_AT]: {
    code: MilestoneDocumentsErrorCode.INVALID_GRACE_DUE_AT,
    status: 422,
    message:
      '유예 기한은 마일스톤 마감 이후이며 프로그램 종료 1년 뒤의 파일 보관 만료 시각보다 앞이어야 합니다.',
  },
  [MilestoneDocumentsErrorCode.SELF_REVIEW_FORBIDDEN]: {
    code: MilestoneDocumentsErrorCode.SELF_REVIEW_FORBIDDEN,
    status: 403,
    message:
      '자기 팀 서류는 검토할 수 없습니다. 다른 교직원이나 운영자에게 검토를 요청해 주세요.',
  },
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
    message: '승인된 교직원만 사용할 수 있습니다.',
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
