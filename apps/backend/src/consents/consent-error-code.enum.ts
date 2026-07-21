import { ErrorCode } from '../common/error-code';

export enum ConsentErrorCode {
  UNAUTHENTICATED = 'CON_001',
  POLICY_VERSION_STALE = 'CON_002',
  REQUIRED_CONSENT_MISSING = 'CON_003',
}

export const CONSENT_ERROR_CODES: Record<ConsentErrorCode, ErrorCode> = {
  [ConsentErrorCode.UNAUTHENTICATED]: {
    code: ConsentErrorCode.UNAUTHENTICATED,
    status: 401,
    message: '로그인이 필요합니다.',
  },
  [ConsentErrorCode.POLICY_VERSION_STALE]: {
    code: ConsentErrorCode.POLICY_VERSION_STALE,
    status: 409,
    message: '정책 버전이 갱신되었습니다. 최신 정책을 다시 확인해 주세요.',
  },
  [ConsentErrorCode.REQUIRED_CONSENT_MISSING]: {
    code: ConsentErrorCode.REQUIRED_CONSENT_MISSING,
    status: 422,
    message: '필수 동의 항목이 모두 포함되어야 합니다.',
  },
};
