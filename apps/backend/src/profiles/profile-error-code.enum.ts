import type { ErrorCode } from '../common/error-code';

export enum ProfileErrorCode {
  PUBLIC_PROFILE_NOT_FOUND = 'PRF_001',
}

export const PROFILE_ERROR_CODES: Record<ProfileErrorCode, ErrorCode> = {
  [ProfileErrorCode.PUBLIC_PROFILE_NOT_FOUND]: {
    code: ProfileErrorCode.PUBLIC_PROFILE_NOT_FOUND,
    status: 404,
    message: '공개 프로필을 찾을 수 없습니다.',
  },
};
