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
