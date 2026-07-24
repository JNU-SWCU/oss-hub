import type { ErrorCode } from '../common/error-code';

export enum RolesErrorCode {
  INVALID_ROLE_SELECTION = 'ROL_001',
  ROLE_ALREADY_CONFIRMED = 'ROL_002',
  ACTIVE_REQUEST_EXISTS = 'ROL_003',
  ADMIN_ONLY = 'ROL_004',
  REJECTION_REASON_REQUIRED = 'ROL_005',
  ROLE_REQUEST_NOT_FOUND = 'ROL_006',
  ROLE_REQUEST_ALREADY_DECIDED = 'ROL_007',
  ROLE_STATE_CONFLICT = 'ROL_008',
  INVALID_ROLE_REQUEST_ACTION = 'ROL_009',
  USER_NOT_FOUND = 'ROL_010',
  INVALID_USER_ID = 'ROL_011',
  INVALID_USER_ROLE = 'ROL_012',
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
  [RolesErrorCode.ADMIN_ONLY]: {
    code: RolesErrorCode.ADMIN_ONLY,
    status: 403,
    message: '관리자만 교직원 권한 요청을 관리할 수 있습니다.',
  },
  [RolesErrorCode.REJECTION_REASON_REQUIRED]: {
    code: RolesErrorCode.REJECTION_REASON_REQUIRED,
    status: 400,
    message: '반려 사유를 입력해 주세요.',
  },
  [RolesErrorCode.ROLE_REQUEST_NOT_FOUND]: {
    code: RolesErrorCode.ROLE_REQUEST_NOT_FOUND,
    status: 404,
    message: '교직원 권한 요청을 찾을 수 없습니다.',
  },
  [RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED]: {
    code: RolesErrorCode.ROLE_REQUEST_ALREADY_DECIDED,
    status: 409,
    message: '다른 관리자가 이미 처리한 요청입니다.',
  },
  [RolesErrorCode.ROLE_STATE_CONFLICT]: {
    code: RolesErrorCode.ROLE_STATE_CONFLICT,
    status: 409,
    message: '현재 사용자 역할과 요청 상태가 일치하지 않습니다.',
  },
  [RolesErrorCode.INVALID_ROLE_REQUEST_ACTION]: {
    code: RolesErrorCode.INVALID_ROLE_REQUEST_ACTION,
    status: 400,
    message: '지원하지 않는 요청 처리 방식입니다.',
  },
  [RolesErrorCode.USER_NOT_FOUND]: {
    code: RolesErrorCode.USER_NOT_FOUND,
    status: 404,
    message: '사용자를 찾을 수 없습니다.',
  },
  [RolesErrorCode.INVALID_USER_ID]: {
    code: RolesErrorCode.INVALID_USER_ID,
    status: 400,
    message: '올바르지 않은 사용자 ID입니다.',
  },
  [RolesErrorCode.INVALID_USER_ROLE]: {
    code: RolesErrorCode.INVALID_USER_ROLE,
    status: 400,
    message: '지원하지 않는 사용자 역할입니다.',
  },
};
