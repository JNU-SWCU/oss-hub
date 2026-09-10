import { ApiError, type ProblemDetail } from '@/lib/api-client';

export const TEAM_REQUEST_FAILED_MESSAGE =
  '팀 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function mapTeamError(problem: ProblemDetail): string {
  switch (problem.code) {
    case 'TEAM_001':
      return '승인된 학생 계정만 팀을 구성할 수 있습니다.';
    case 'TEAM_004':
      return '신청 기간이 아닙니다.';
    case 'TEAM_006':
      return '이미 이 프로그램의 팀에 소속되어 있습니다. 현재 팀을 다시 확인해 주세요.';
    case 'TEAM_007':
      return '팀 최대 인원을 초과할 수 없습니다.';
    case 'TEAM_010':
      return '소속된 팀이 없습니다. 현재 팀 구성을 다시 확인해 주세요.';
    case 'TEAM_012':
      return '신청 기록을 보존하기 위해 마지막 팀원은 탈퇴할 수 없습니다.';
    case 'TEAM_013':
      return '팀장만 다른 팀원을 제외할 수 있습니다.';
    case 'TEAM_014':
      return '본인은 팀 나가기를 통해 탈퇴할 수 있습니다.';
    case 'TEAM_015':
      return '이 팀의 구성원을 찾을 수 없습니다. 팀 현황을 다시 확인해 주세요.';
    default:
      return problem.detail || TEAM_REQUEST_FAILED_MESSAGE;
  }
}

export function mapTeamActionError(error: unknown): string {
  return error instanceof ApiError
    ? mapTeamError(error.problem)
    : TEAM_REQUEST_FAILED_MESSAGE;
}

/** 초대의 실제 실패 원인을 보존한다. */
export function mapInvitationError(problem: ProblemDetail): string {
  switch (problem.code) {
    case 'TIV_001':
      return '로그인이 필요합니다.';
    case 'TIV_002':
      return '팀을 찾을 수 없습니다.';
    case 'TIV_003':
      return '팀장만 초대를 관리할 수 있습니다.';
    case 'TIV_004':
      return '팀 소속이 변경되었습니다. 현재 팀을 다시 확인해 주세요.';
    case 'TIV_005':
      return '자기 자신을 초대할 수 없습니다.';
    case 'TIV_006':
      return '초대 대상 사용자를 찾을 수 없습니다.';
    case 'TIV_007':
      return '이미 이 프로그램의 다른 팀에 소속된 사용자입니다.';
    case 'TIV_008':
      return '이미 대기 중인 초대가 있습니다.';
    case 'TIV_009':
      return '팀 최대 인원을 초과할 수 없습니다.';
    case 'TIV_010':
      return '초대를 찾을 수 없습니다. 초대 목록을 다시 확인해 주세요.';
    case 'TIV_011':
      return '이미 처리된 초대입니다. 초대 목록을 다시 확인해 주세요.';
    case 'TIV_012':
      return '본인이 받은 초대만 응답할 수 있습니다.';
    default:
      return (
        problem.detail ||
        '초대 요청을 처리하지 못했습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.'
      );
  }
}
