import type { ErrorCode } from '../common/error-code';

export enum RolesErrorCode {
  INVALID_ROLE_SELECTION = 'ROL_001',
  ROLE_ALREADY_CONFIRMED = 'ROL_002',
  ACTIVE_REQUEST_EXISTS = 'ROL_003',
}

export const ROLES_ERROR_CODES: Record<RolesErrorCode, ErrorCode> = {
  [RolesErrorCode.INVALID_ROLE_SELECTION]: {
    code: RolesErrorCode.INVALID_ROLE_SELECTION,
    status: 400,
    message: '선택할 수 없는 역할입니다.',
  },
  [RolesErrorCode.ROLE_ALREADY_CONFIRMED]: {
    code: RolesErrorCode.ROLE_ALREADY_CONFIRMED,
    status: 409,
    message: '이미 확정된 역할은 변경할 수 없습니다.',
  },
  [RolesErrorCode.ACTIVE_REQUEST_EXISTS]: {
    code: RolesErrorCode.ACTIVE_REQUEST_EXISTS,
    status: 409,
    message: '처리 중인 교직원 권한 요청이 이미 있습니다.',
  },
};
