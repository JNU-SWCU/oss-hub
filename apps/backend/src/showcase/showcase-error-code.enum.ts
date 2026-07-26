import type { ErrorCode } from '../common/error-code';

export enum ShowcaseErrorCode {
  PUBLIC_PROJECT_NOT_FOUND = 'SHW_001',
}

export const SHOWCASE_ERROR_CODES: Record<ShowcaseErrorCode, ErrorCode> = {
  [ShowcaseErrorCode.PUBLIC_PROJECT_NOT_FOUND]: {
    code: ShowcaseErrorCode.PUBLIC_PROJECT_NOT_FOUND,
    status: 404,
    message: '공개 프로젝트를 찾을 수 없습니다.',
  },
};
