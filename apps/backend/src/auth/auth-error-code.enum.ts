import { ErrorCode } from '../common/error-code';

export enum AuthErrorCode {
  OAUTH_FLOW_INVALID = 'AUT_001',
  ORIGIN_FORBIDDEN = 'AUT_002',
  UNAUTHENTICATED = 'AUT_003',
}

export const AUTH_ERROR_CODES: Record<AuthErrorCode, ErrorCode> = {
  [AuthErrorCode.OAUTH_FLOW_INVALID]: {
    code: AuthErrorCode.OAUTH_FLOW_INVALID,
    status: 400,
    message: 'OAuth 로그인 요청이 올바르지 않습니다.',
  },
  [AuthErrorCode.ORIGIN_FORBIDDEN]: {
    code: AuthErrorCode.ORIGIN_FORBIDDEN,
    status: 403,
    message: '허용되지 않은 Origin의 요청입니다.',
  },
  [AuthErrorCode.UNAUTHENTICATED]: {
    code: AuthErrorCode.UNAUTHENTICATED,
    status: 401,
    message: '로그인이 필요합니다.',
  },
};
