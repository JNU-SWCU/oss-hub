import type { ErrorCode } from '../common/error-code';

export enum TeamsErrorCode {
  STUDENT_ONLY = 'TEAM_001',
  PROGRAM_NOT_FOUND = 'TEAM_002',
  TEAM_NOT_ALLOWED = 'TEAM_003',
  APPLICATION_PERIOD_CLOSED = 'TEAM_004',
  TEAM_SIZE_MISCONFIGURED = 'TEAM_005',
  ALREADY_IN_PROGRAM_TEAM = 'TEAM_006',
  TEAM_FULL = 'TEAM_007',
  TEAM_LOCKED_AFTER_APPLICATION = 'TEAM_008',
  JOIN_CODE_NOT_FOUND = 'TEAM_009',
  TEAM_NOT_FOUND = 'TEAM_010',
}

export const TEAMS_ERROR_CODES: Record<TeamsErrorCode, ErrorCode> = {
  [TeamsErrorCode.STUDENT_ONLY]: {
    code: TeamsErrorCode.STUDENT_ONLY,
    status: 403,
    message: '승인된 학생 계정만 팀을 구성할 수 있습니다.',
  },
  [TeamsErrorCode.PROGRAM_NOT_FOUND]: {
    code: TeamsErrorCode.PROGRAM_NOT_FOUND,
    status: 404,
    message: '프로그램을 찾을 수 없습니다.',
  },
  [TeamsErrorCode.TEAM_NOT_ALLOWED]: {
    code: TeamsErrorCode.TEAM_NOT_ALLOWED,
    status: 422,
    message: '개인형 프로그램에서는 팀을 구성할 수 없습니다.',
  },
  [TeamsErrorCode.APPLICATION_PERIOD_CLOSED]: {
    code: TeamsErrorCode.APPLICATION_PERIOD_CLOSED,
    status: 422,
    message: '신청 기간이 아닙니다.',
  },
  [TeamsErrorCode.TEAM_SIZE_MISCONFIGURED]: {
    code: TeamsErrorCode.TEAM_SIZE_MISCONFIGURED,
    status: 422,
    message: '팀 최대 인원이 설정되지 않은 프로그램입니다.',
  },
  [TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM]: {
    code: TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM,
    status: 409,
    message: '이미 이 프로그램의 팀에 소속되어 있습니다.',
  },
  [TeamsErrorCode.TEAM_FULL]: {
    code: TeamsErrorCode.TEAM_FULL,
    status: 409,
    message: '팀 최대 인원을 초과할 수 없습니다.',
  },
  [TeamsErrorCode.TEAM_LOCKED_AFTER_APPLICATION]: {
    code: TeamsErrorCode.TEAM_LOCKED_AFTER_APPLICATION,
    status: 409,
    message: '신청 제출 후 팀을 변경할 수 없습니다.',
  },
  [TeamsErrorCode.JOIN_CODE_NOT_FOUND]: {
    code: TeamsErrorCode.JOIN_CODE_NOT_FOUND,
    status: 404,
    message: '참여 코드를 찾을 수 없습니다.',
  },
  [TeamsErrorCode.TEAM_NOT_FOUND]: {
    code: TeamsErrorCode.TEAM_NOT_FOUND,
    status: 404,
    message: '소속된 팀이 없습니다.',
  },
};
