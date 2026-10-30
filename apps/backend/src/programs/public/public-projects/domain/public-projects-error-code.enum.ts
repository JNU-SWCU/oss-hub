import type { ErrorCode } from '../../../../common/error-code';

export enum PublicProjectsErrorCode {
  PROJECT_NOT_FOUND = 'PPJ_001',
  USER_PROFILE_NOT_FOUND = 'PPJ_002',
  INVALID_PAGE_ID = 'PPJ_003',
}

export const PUBLIC_PROJECTS_ERROR_CODES: Record<
  PublicProjectsErrorCode,
  ErrorCode
> = {
  [PublicProjectsErrorCode.PROJECT_NOT_FOUND]: {
    code: PublicProjectsErrorCode.PROJECT_NOT_FOUND,
    status: 404,
    message: '공개 프로젝트를 찾을 수 없습니다.',
  },

  [PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND]: {
    code: PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND,
    status: 404,
    message: '공개 프로필을 찾을 수 없습니다.',
  },
  [PublicProjectsErrorCode.INVALID_PAGE_ID]: {
    code: PublicProjectsErrorCode.INVALID_PAGE_ID,
    status: 400,
    message: '페이지 커서가 올바르지 않습니다.',
  },
};
