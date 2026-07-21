import type { ErrorCode } from '../common/error-code';

export const PROGRAM_ERROR_CODES = {
  NOT_FOUND: {
    code: 'PROGRAM_NOT_FOUND',
    status: 404,
    message: '프로그램을 찾을 수 없습니다.',
  },
  DETAIL_LOAD_FAILED: {
    code: 'PROGRAM_DETAIL_LOAD_FAILED',
    status: 500,
    message: '프로그램 상세 정보를 불러오지 못했습니다.',
  },
} as const satisfies Readonly<Record<string, ErrorCode>>;
