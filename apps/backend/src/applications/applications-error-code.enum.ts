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
  // APP_012·APP_013은 참여 유형(TEAM_REQUIRED·TEAM_NOT_ALLOWED)이 쓰던 번호이고
  // D6로 은퇴했다. 공개 계약이라 다른 의미로 재사용하지 않는다(ADR-004) —
  // 구 클라이언트가 은퇴 코드를 옛 뜻으로 읽으면 오동작한다.
  TEAM_MEMBERSHIP_REQUIRED = 'APP_014',
  INVALID_ANSWERS = 'APP_015',
  TEMPLATE_VERSION_MISMATCH = 'APP_016',
  TEAM_NOT_FOUND = 'APP_017',
  /** 목록·요약 등 조회용 — 판정 전용 문구 금지 (#106/#117). */
  STAFF_LIST_ONLY = 'APP_018',
  TEAM_MIN_SIZE_NOT_MET = 'APP_019',
  PROGRAM_ARCHIVED = 'APP_020',
  /** SUBMITTED 등 판정 전이 아닌 상태에 REVERT를 시도. */
  APPLICATION_REVERT_INVALID_STATUS = 'APP_021',
  /** OWN 연결인데 repositoryUrl이 정확한 GitHub 저장소 URL이 아닐 때. */
  OWN_REPOSITORY_URL_REQUIRED = 'APP_022',
  /** 프로비저닝이 완료된 승인은 되돌릴 수 없다. */
  APPLICATION_REVERT_BLOCKED = 'APP_023',
  /** 신청 항목이 길이 상한을 넘었다 — 「올바르지 않다」와 갈라야 무엇을 줄일지 안다. */
  ANSWER_TOO_LONG = 'APP_024',
  REPOSITORY_CONNECTION_MODE_REQUIRED = 'APP_025',
  REPOSITORY_CONNECTION_MODE_FORBIDDEN = 'APP_026',
  /**
   * OWN 연결 URL의 형식은 유효하지만 GitHub에서 찾을 수 없거나 비공개다
   * (제출 시점 사전 검증 — #9 QA econovation 배치). 형식 오류는 APP_022가 계속 맡는다.
   */
  OWN_REPOSITORY_URL_UNREACHABLE = 'APP_027',
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
  [ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED]: {
    code: ApplicationsErrorCode.OWN_REPOSITORY_URL_REQUIRED,
    status: 400,
    message: '자체 저장소 연결에는 유효한 GitHub repositoryUrl이 필요합니다.',
  },
  [ApplicationsErrorCode.APPLICATION_REVERT_BLOCKED]: {
    code: ApplicationsErrorCode.APPLICATION_REVERT_BLOCKED,
    status: 409,
    message: '저장소 프로비저닝이 완료된 승인은 되돌릴 수 없습니다.',
  },
  [ApplicationsErrorCode.ANSWER_TOO_LONG]: {
    code: ApplicationsErrorCode.ANSWER_TOO_LONG,
    status: 400,
    message: '신청 항목이 너무 깁니다.',
  },
  [ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_REQUIRED]: {
    code: ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_REQUIRED,
    status: 400,
    message: '저장소 발급 방식을 선택해 주세요.',
  },
  [ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_FORBIDDEN]: {
    code: ApplicationsErrorCode.REPOSITORY_CONNECTION_MODE_FORBIDDEN,
    status: 400,
    message: '저장소 발급을 사용하지 않는 프로그램입니다.',
  },
  [ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE]: {
    code: ApplicationsErrorCode.OWN_REPOSITORY_URL_UNREACHABLE,
    status: 400,
    message:
      '연결하려는 저장소를 찾을 수 없거나 비공개 저장소입니다. GitHub에 공개된 저장소만 연결할 수 있습니다.',
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
  [ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET]: {
    code: ApplicationsErrorCode.TEAM_MIN_SIZE_NOT_MET,
    status: 422,
    message: '팀 최소 인원을 충족해야 신청할 수 있습니다.',
  },
  [ApplicationsErrorCode.PROGRAM_ARCHIVED]: {
    code: ApplicationsErrorCode.PROGRAM_ARCHIVED,
    status: 422,
    message: '내린 프로그램에는 신청할 수 없습니다.',
  },
  [ApplicationsErrorCode.APPLICATION_REVERT_INVALID_STATUS]: {
    code: ApplicationsErrorCode.APPLICATION_REVERT_INVALID_STATUS,
    status: 409,
    message: '판정된 신청만 되돌릴 수 있습니다.',
  },
};
