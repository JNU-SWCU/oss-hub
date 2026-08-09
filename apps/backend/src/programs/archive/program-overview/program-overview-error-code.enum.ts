import { ErrorCode } from '../common/error-code';

export enum ProgramOverviewErrorCode {
  PROGRAM_NOT_FOUND = 'POV_001',
}

export const PROGRAM_OVERVIEW_ERROR_CODES: Record<
  ProgramOverviewErrorCode,
  ErrorCode
> = {
  [ProgramOverviewErrorCode.PROGRAM_NOT_FOUND]: {
    code: ProgramOverviewErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message: '프로그램을 찾을 수 없습니다.',
  },
};
