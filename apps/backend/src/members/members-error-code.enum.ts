import { ErrorCode } from '../common/error-code';

export enum MembersErrorCode {
  MEMBER_NOT_FOUND = 'MEM_001',
}

export const MEMBER_ERROR_CODES: Record<MembersErrorCode, ErrorCode> = {
  [MembersErrorCode.MEMBER_NOT_FOUND]: {
    code: MembersErrorCode.MEMBER_NOT_FOUND,
    status: 404,
    message: '회원을 찾을 수 없습니다.',
  },
};
