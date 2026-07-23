import type { ErrorCode } from '../common/error-code';

export enum UsersErrorCode {
  PROFILE_ALREADY_COMPLETE = 'USR_001',
}

export const USERS_ERROR_CODES: Record<UsersErrorCode, ErrorCode> = {
  [UsersErrorCode.PROFILE_ALREADY_COMPLETE]: {
    code: UsersErrorCode.PROFILE_ALREADY_COMPLETE,
    status: 409,
    message: '온보딩 프로필이 이미 저장되었습니다.',
  },
};
