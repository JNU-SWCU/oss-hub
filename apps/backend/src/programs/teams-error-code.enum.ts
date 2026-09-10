import type { ErrorCode } from '../common/error-code';

/**
 * 은퇴한 코드(`TEAM_005`, `TEAM_008`, `TEAM_009`, `TEAM_011`)는 재사용하지 않는다 —
 * 구 클라이언트가 은퇴 코드를 옛 뜻으로 읽으면 오동작한다. 새 코드는 `TEAM_012`부터
 * 이어 붙인다.
 */
export enum TeamsErrorCode {
  STUDENT_ONLY = 'TEAM_001',
  PROGRAM_NOT_FOUND = 'TEAM_002',
  STAFF_ONLY = 'TEAM_003',
  APPLICATION_PERIOD_CLOSED = 'TEAM_004',
  ALREADY_IN_PROGRAM_TEAM = 'TEAM_006',
  TEAM_FULL = 'TEAM_007',
  TEAM_NOT_FOUND = 'TEAM_010',
  LAST_MEMBER_WITH_APPLICATION = 'TEAM_012',
  TEAM_LEADER_REQUIRED = 'TEAM_013',
  SELF_REMOVAL_REQUIRES_LEAVE = 'TEAM_014',
  TARGET_MEMBER_NOT_FOUND = 'TEAM_015',
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
  [TeamsErrorCode.STAFF_ONLY]: {
    code: TeamsErrorCode.STAFF_ONLY,
    status: 403,
    message: '교직원 계정만 참여 팀 목록을 볼 수 있습니다.',
  },
  [TeamsErrorCode.APPLICATION_PERIOD_CLOSED]: {
    code: TeamsErrorCode.APPLICATION_PERIOD_CLOSED,
    status: 422,
    message: '신청 기간이 아닙니다.',
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
  [TeamsErrorCode.TEAM_NOT_FOUND]: {
    code: TeamsErrorCode.TEAM_NOT_FOUND,
    status: 404,
    message: '소속된 팀이 없습니다.',
  },
  [TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION]: {
    code: TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION,
    status: 409,
    message: '신청 기록이 있는 팀의 마지막 구성원은 나갈 수 없습니다.',
  },
  [TeamsErrorCode.TEAM_LEADER_REQUIRED]: {
    code: TeamsErrorCode.TEAM_LEADER_REQUIRED,
    status: 403,
    message: '팀장만 팀원을 제외할 수 있습니다.',
  },
  [TeamsErrorCode.SELF_REMOVAL_REQUIRES_LEAVE]: {
    code: TeamsErrorCode.SELF_REMOVAL_REQUIRES_LEAVE,
    status: 409,
    message: '본인은 제외할 수 없습니다. 팀 나가기를 사용해 주세요.',
  },
  [TeamsErrorCode.TARGET_MEMBER_NOT_FOUND]: {
    code: TeamsErrorCode.TARGET_MEMBER_NOT_FOUND,
    status: 404,
    message: '해당 팀원을 찾을 수 없습니다.',
  },
};
