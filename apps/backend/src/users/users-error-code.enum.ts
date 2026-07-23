import type { ErrorCode } from '../common/error-code';

export enum UsersErrorCode {
  PROFILE_ALREADY_COMPLETE = 'USR_001',
  PROFILE_INCOMPLETE = 'USR_002',
}

export const USERS_ERROR_CODES: Record<UsersErrorCode, ErrorCode> = {
  [UsersErrorCode.PROFILE_ALREADY_COMPLETE]: {
    code: UsersErrorCode.PROFILE_ALREADY_COMPLETE,
    status: 409,
    message: '온보딩 프로필이 이미 저장되었습니다.',
  },
  [UsersErrorCode.PROFILE_INCOMPLETE]: {
    code: UsersErrorCode.PROFILE_INCOMPLETE,
    status: 409,
    message: '역할을 선택하기 전에 온보딩 프로필을 완료해 주세요.',
  },
};
