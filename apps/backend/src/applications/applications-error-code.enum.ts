import type { ErrorCode } from '../common/error-code';

export enum ApplicationsErrorCode {
  APPLICATION_NOT_FOUND = 'APP_001',
  APPLICATION_ALREADY_DECIDED = 'APP_002',
  REJECTION_REASON_REQUIRED = 'APP_003',
  STAFF_ONLY = 'APP_004',
  REPOSITORY_EVENT_ALREADY_EXISTS = 'APP_005',
  INVALID_DECISION_ACTION = 'APP_006',
  DECISION_TRANSACTION_FAILED = 'APP_007',
  STUDENT_ONLY = 'APP_008',
  PROGRAM_NOT_FOUND = 'APP_009',
  APPLICATION_PERIOD_CLOSED = 'APP_010',
  DUPLICATE_APPLICATION = 'APP_011',
  TEAM_REQUIRED = 'APP_012',
  TEAM_NOT_ALLOWED = 'APP_013',
  TEAM_MEMBERSHIP_REQUIRED = 'APP_014',
  INVALID_ANSWERS = 'APP_015',
  TEMPLATE_VERSION_MISMATCH = 'APP_016',
  TEAM_NOT_FOUND = 'APP_017',
  /** 목록·요약 등 조회용 — 판정 전용 문구 금지 (#106/#117). */
  STAFF_LIST_ONLY = 'APP_018',
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
  [ApplicationsErrorCode.STUDENT_ONLY]: {
    code: ApplicationsErrorCode.STUDENT_ONLY,
    status: 403,
    message: '승인된 학생 계정만 신청할 수 있습니다.',
  },
  [ApplicationsErrorCode.PROGRAM_NOT_FOUND]: {
    code: ApplicationsErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message: '프로그램을 찾을 수 없습니다.',
  },
  [ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED]: {
    code: ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
    status: 422,
    message: '신청 기간이 아닙니다.',
  },
  [ApplicationsErrorCode.DUPLICATE_APPLICATION]: {
    code: ApplicationsErrorCode.DUPLICATE_APPLICATION,
    status: 409,
    message: '이미 제출한 신청이 있습니다.',
  },
  [ApplicationsErrorCode.TEAM_REQUIRED]: {
    code: ApplicationsErrorCode.TEAM_REQUIRED,
    status: 400,
    message: '팀형 프로그램은 팀 구성 후 신청할 수 있습니다.',
  },
  [ApplicationsErrorCode.TEAM_NOT_ALLOWED]: {
    code: ApplicationsErrorCode.TEAM_NOT_ALLOWED,
    status: 400,
    message: '개인형 프로그램에는 팀을 지정할 수 없습니다.',
  },
  [ApplicationsErrorCode.TEAM_MEMBERSHIP_REQUIRED]: {
    code: ApplicationsErrorCode.TEAM_MEMBERSHIP_REQUIRED,
    status: 403,
    message: '해당 팀의 구성원만 신청할 수 있습니다.',
  },
  [ApplicationsErrorCode.INVALID_ANSWERS]: {
    code: ApplicationsErrorCode.INVALID_ANSWERS,
    status: 400,
    message: '신청 항목이 올바르지 않습니다.',
  },
  [ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH]: {
    code: ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH,
    status: 409,
    message: '신청 양식 버전이 변경되었습니다. 다시 불러와 주세요.',
  },
  [ApplicationsErrorCode.TEAM_NOT_FOUND]: {
    code: ApplicationsErrorCode.TEAM_NOT_FOUND,
    status: 404,
    message: '팀을 찾을 수 없습니다.',
  },
  [ApplicationsErrorCode.STAFF_LIST_ONLY]: {
    code: ApplicationsErrorCode.STAFF_LIST_ONLY,
    status: 403,
    message: '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
  },
};
