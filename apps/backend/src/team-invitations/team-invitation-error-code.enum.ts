import { ErrorCode } from '../common/error-code';

export enum TeamInvitationErrorCode {
  UNAUTHENTICATED = 'TIV_001',
  TEAM_NOT_FOUND = 'TIV_002',
  NOT_TEAM_LEADER = 'TIV_003',
  NOT_TEAM_MEMBER = 'TIV_004',
  SELF_INVITE_FORBIDDEN = 'TIV_005',
  INVITEE_NOT_FOUND = 'TIV_006',
  INVITEE_ALREADY_IN_TEAM = 'TIV_007',
  ALREADY_INVITED = 'TIV_008',
  TEAM_FULL = 'TIV_009',
  INVITATION_NOT_FOUND = 'TIV_010',
  INVITATION_NOT_PENDING = 'TIV_011',
  NOT_INVITEE = 'TIV_012',
  INVITEE_NOT_ELIGIBLE = 'TIV_013',
  TEAM_LOCKED_AFTER_APPLICATION = 'TIV_014',
}

export const TEAM_INVITATION_ERROR_CODES: Record<
  TeamInvitationErrorCode,
  ErrorCode
> = {
  [TeamInvitationErrorCode.UNAUTHENTICATED]: {
    code: TeamInvitationErrorCode.UNAUTHENTICATED,
    status: 401,
    message: '로그인이 필요합니다.',
  },
  [TeamInvitationErrorCode.TEAM_NOT_FOUND]: {
    code: TeamInvitationErrorCode.TEAM_NOT_FOUND,
    status: 404,
    message: '팀을 찾을 수 없습니다.',
  },
  [TeamInvitationErrorCode.NOT_TEAM_LEADER]: {
    code: TeamInvitationErrorCode.NOT_TEAM_LEADER,
    status: 403,
    message: '팀장만 초대를 관리할 수 있습니다.',
  },
  [TeamInvitationErrorCode.NOT_TEAM_MEMBER]: {
    code: TeamInvitationErrorCode.NOT_TEAM_MEMBER,
    status: 403,
    message: '팀 구성원만 조회할 수 있습니다.',
  },
  [TeamInvitationErrorCode.SELF_INVITE_FORBIDDEN]: {
    code: TeamInvitationErrorCode.SELF_INVITE_FORBIDDEN,
    status: 422,
    message: '자기 자신을 초대할 수 없습니다.',
  },
  [TeamInvitationErrorCode.INVITEE_NOT_FOUND]: {
    code: TeamInvitationErrorCode.INVITEE_NOT_FOUND,
    status: 404,
    message: '초대 대상 사용자를 찾을 수 없습니다.',
  },
  [TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM]: {
    code: TeamInvitationErrorCode.INVITEE_ALREADY_IN_TEAM,
    status: 409,
    message: '이미 이 프로그램의 다른 팀에 소속된 사용자입니다.',
  },
  [TeamInvitationErrorCode.ALREADY_INVITED]: {
    code: TeamInvitationErrorCode.ALREADY_INVITED,
    status: 409,
    message: '이미 대기 중인 초대가 있습니다.',
  },
  [TeamInvitationErrorCode.TEAM_FULL]: {
    code: TeamInvitationErrorCode.TEAM_FULL,
    status: 409,
    message: '팀 최대 인원을 초과할 수 없습니다.',
  },
  [TeamInvitationErrorCode.INVITATION_NOT_FOUND]: {
    code: TeamInvitationErrorCode.INVITATION_NOT_FOUND,
    status: 404,
    message: '초대를 찾을 수 없습니다.',
  },
  [TeamInvitationErrorCode.INVITATION_NOT_PENDING]: {
    code: TeamInvitationErrorCode.INVITATION_NOT_PENDING,
    status: 409,
    message: '이미 처리된 초대입니다.',
  },
  [TeamInvitationErrorCode.NOT_INVITEE]: {
    code: TeamInvitationErrorCode.NOT_INVITEE,
    status: 403,
    message: '본인이 받은 초대만 응답할 수 있습니다.',
  },
  [TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE]: {
    code: TeamInvitationErrorCode.INVITEE_NOT_ELIGIBLE,
    status: 422,
    message: '활성 학생 계정만 팀원으로 초대할 수 있습니다.',
  },
  [TeamInvitationErrorCode.TEAM_LOCKED_AFTER_APPLICATION]: {
    code: TeamInvitationErrorCode.TEAM_LOCKED_AFTER_APPLICATION,
    status: 409,
    message: '신청 제출 후에는 팀 구성원을 변경할 수 없습니다.',
  },
};
