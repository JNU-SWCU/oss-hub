import type { ErrorCode } from '../common/error-code';

export enum ProgramErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  FORBIDDEN = 'FORBIDDEN',
}

export const PROGRAM_ERROR_CODES: Record<ProgramErrorCode, ErrorCode> = {
  [ProgramErrorCode.VALIDATION_ERROR]: {
    code: ProgramErrorCode.VALIDATION_ERROR,
    status: 400,
    message: '프로그램 입력값이 올바르지 않습니다.',
  },
  [ProgramErrorCode.FORBIDDEN]: {
    code: ProgramErrorCode.FORBIDDEN,
    status: 403,
    message: '프로그램을 생성할 권한이 없습니다.',
  },
};
