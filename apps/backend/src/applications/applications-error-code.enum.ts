import type { ErrorCode } from '../common/error-code';

export enum ApplicationsErrorCode {
  APPLICATION_NOT_FOUND = 'APP_001',
  APPLICATION_ALREADY_DECIDED = 'APP_002',
  REJECTION_REASON_REQUIRED = 'APP_003',
  STAFF_ONLY = 'APP_004',
  REPOSITORY_EVENT_ALREADY_EXISTS = 'APP_005',
  INVALID_DECISION_ACTION = 'APP_006',
  DECISION_TRANSACTION_FAILED = 'APP_007',
}

export const APPLICATIONS_ERROR_CODES: Record<
  ApplicationsErrorCode,
  ErrorCode
> = {
  [ApplicationsErrorCode.APPLICATION_NOT_FOUND]: {
    code: ApplicationsErrorCode.APPLICATION_NOT_FOUND,
    status: 404,
    message: '신청을 찾을 수 없습니다.',
  },
  [ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED]: {
    code: ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED,
    status: 409,
    message: '이미 판정된 신청입니다.',
  },
  [ApplicationsErrorCode.REJECTION_REASON_REQUIRED]: {
    code: ApplicationsErrorCode.REJECTION_REASON_REQUIRED,
    status: 400,
    message: '반려 사유를 입력해 주세요.',
  },
  [ApplicationsErrorCode.STAFF_ONLY]: {
    code: ApplicationsErrorCode.STAFF_ONLY,
    status: 403,
    message: '승인된 교직원 또는 관리자만 신청을 판정할 수 있습니다.',
  },
  [ApplicationsErrorCode.REPOSITORY_EVENT_ALREADY_EXISTS]: {
    code: ApplicationsErrorCode.REPOSITORY_EVENT_ALREADY_EXISTS,
    status: 409,
    message: '저장소 생성 요청 이벤트가 이미 존재합니다.',
  },
  [ApplicationsErrorCode.INVALID_DECISION_ACTION]: {
    code: ApplicationsErrorCode.INVALID_DECISION_ACTION,
    status: 400,
    message: '지원하지 않는 신청 판정 방식입니다.',
  },
  [ApplicationsErrorCode.DECISION_TRANSACTION_FAILED]: {
    code: ApplicationsErrorCode.DECISION_TRANSACTION_FAILED,
    status: 500,
    message: '신청 판정을 처리하지 못했습니다.',
    exposeToClient: true,
  },
};
