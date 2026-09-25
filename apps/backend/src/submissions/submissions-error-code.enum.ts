import type { ErrorCode } from '../common/error-code';
import { SUBMISSION_UPLOAD_TOO_LARGE_MESSAGE } from './submission-upload-policy';
import {
  SUBMISSION_ZIP_REJECTION_MESSAGES,
  SubmissionZipRejection,
} from './submission-zip-admission';

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
  /*
   * 여기부터는 **압축 파일 안을 들여다본 뒤** 막은 갈래다(#1108). 형식·서명 거절
   * (UNSUPPORTED_FILE_TYPE)과 절대 같은 코드를 쓰지 않는다 — `.zip`은 허용 형식이라
   * 「지원하지 않는 파일 형식입니다」는 사실이 아니고, 학생을 원인과 무관한 쪽으로 보낸다.
   * 갈래를 나눈 기준과 문구는 `submission-zip-admission.ts`가 소유한다.
   */
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
    // 문구는 `submission-upload-policy.ts`가 소유한다 — 여기 숫자를 다시 적으면 화면
    // 안내와 413 응답이 다른 숫자를 말하게 된다(#1106, #1107).
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
  /*
   * 압축 파일 내용 거절 여덟 갈래(#1108). 상태 코드가 415가 아니라 422인 이유:
   * 415는 「이 미디어 타입은 받지 않는다」는 뜻인데 `.zip`은 받는 형식이다. 여기서 막히는
   * 것은 형식이 아니라 **그 안에 담긴 것**이므로 「형식은 맞지만 처리할 수 없다」는 422가
   * 사실에 맞다. 문구는 여덟 갈래 모두 `submission-zip-admission.ts`가 소유하며 서류
   * 경로(MSD_*)도 같은 문장을 쓴다.
   */
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

/**
 * 압축 파일 입장 검사의 거절 사유 → 제출 경로 오류 코드.
 *
 * `Record<SubmissionZipRejection, …>`으로 적어 둔 것이 요점이다 — 갈래가 하나 늘면
 * 컴파일이 실패한다. 새 갈래가 조용히 옛 코드로 접혀 다시 「사유 하나로 뭉개기」가
 * 되살아나는 길을 타입이 막는다.
 */
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
