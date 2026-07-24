import type { ErrorCode } from '../common/error-code';

export enum AuditLogErrorCode {
  ADMIN_ONLY = 'AUD_001',
  INVALID_DATE_RANGE = 'AUD_002',
}

export const AUDIT_LOG_ERROR_CODES: Record<AuditLogErrorCode, ErrorCode> = {
  [AuditLogErrorCode.ADMIN_ONLY]: {
    code: AuditLogErrorCode.ADMIN_ONLY,
    status: 403,
    message: '관리자만 감사 로그에 접근할 수 있습니다.',
  },
  [AuditLogErrorCode.INVALID_DATE_RANGE]: {
    code: AuditLogErrorCode.INVALID_DATE_RANGE,
    status: 400,
    message: '시작일은 종료일보다 늦을 수 없습니다.',
  },
};
