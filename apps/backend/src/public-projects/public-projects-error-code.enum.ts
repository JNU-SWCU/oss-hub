import type { ErrorCode } from '../common/error-code';

export enum PublicProjectsErrorCode {
  PROJECT_NOT_FOUND = 'PPJ_001',
  USER_PROFILE_NOT_FOUND = 'PPJ_002',
  INVALID_PAGE_ID = 'PPJ_003',
}

export const PUBLIC_PROJECTS_ERROR_CODES: Record<
  PublicProjectsErrorCode,
  ErrorCode
> = {
  // 비공개 저장소와 존재하지 않는 저장소가 항상 이 코드/메시지로 동일하게 보인다.
  [PublicProjectsErrorCode.PROJECT_NOT_FOUND]: {
    code: PublicProjectsErrorCode.PROJECT_NOT_FOUND,
    status: 404,
    message: '공개 프로젝트를 찾을 수 없습니다.',
  },
  // 존재하지 않는 사용자와 공개 가능한 프로젝트가 하나도 없는 사용자가 항상 동일하게 보인다.
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
