import type { ErrorCode } from '../common/error-code';

export const PROGRAM_NOTICE_ERRORS = {
  INVALID_URL: {
    code: 'PROGRAM_NOTICE_INVALID_URL',
    status: 400,
    message: '지원하는 공지 URL을 입력해 주세요.',
  },
  FETCH_FAILED: {
    code: 'PROGRAM_NOTICE_FETCH_FAILED',
    status: 502,
    message: '공지를 불러오지 못했습니다. 원문 주소를 확인해 주세요.',
    exposeToClient: true,
  },
  UNSUPPORTED_CONTENT: {
    code: 'PROGRAM_NOTICE_UNSUPPORTED_CONTENT',
    status: 422,
    message: '공지 내용을 추출하지 못했습니다. 직접 입력해 주세요.',
  },
  RATE_LIMITED: {
    code: 'PROGRAM_NOTICE_RATE_LIMITED',
    status: 429,
    message: '잠시 후 다시 공지를 불러와 주세요.',
  },
} as const satisfies Readonly<Record<string, ErrorCode>>;
