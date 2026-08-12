import { ApiError, type ProblemDetail } from '@/lib/api-client';
import type { ProgramTeam } from './api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';
import { programHref } from './program-paths';

export type ProgramTeamsPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'empty';
      readonly program: ProgramDetail;
      readonly template: ApplicationFormTemplate;
    }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;
      readonly template: ApplicationFormTemplate;
      readonly team: ProgramTeam;
      readonly joinCode: string | null;
    };

/** 팀 화면에서 실패할 수 있는 동작. 원인을 짚어 줄 수 있는 지점이 서로 다르다. */
export type ProgramTeamAction = 'create' | 'join';

/** 만들기 실패는 사용자가 직접 고칠 수 있는 입력이 팀 이름뿐이다. */
export const TEAM_CREATE_FAILED_MESSAGE =
  '팀을 만들지 못했습니다. 팀 이름을 확인한 뒤 다시 시도해 주세요.';

/** 합류 실패의 가장 흔한 원인은 참여 코드 오기이므로 그것을 먼저 지목한다. */
export const TEAM_JOIN_FAILED_MESSAGE =
  '팀에 합류하지 못했습니다. 참여 코드가 맞는지 확인한 뒤 다시 시도해 주세요.';

/** 코드를 알 수 없는 fallback. 최소한 "다시 해도 되는 상황"인지는 알려 준다. */
export const TEAM_REQUEST_FAILED_MESSAGE =
  '팀 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function mapTeamError(problem: ProblemDetail): string {
  switch (problem.code) {
    case 'TEAM_001':
      return '승인된 학생 계정만 팀을 구성할 수 있습니다.';
    case 'TEAM_004':
      return '신청 기간이 아닙니다.';
    case 'TEAM_006':
      return '이미 이 프로그램의 팀에 소속되어 있습니다.';
    case 'TEAM_007':
      return '팀 최대 인원을 초과할 수 없습니다.';
    case 'TEAM_008':
      return '신청 제출 후 팀을 변경할 수 없습니다.';
    case 'TEAM_009':
      return '참여 코드를 찾을 수 없습니다. 팀장에게 받은 코드를 다시 확인해 주세요.';
    case 'TEAM_010':
      return '소속된 팀이 없습니다.';
    default:
      return problem.detail || TEAM_REQUEST_FAILED_MESSAGE;
  }
}

/**
 * 팀 만들기·합류 실패를 한 곳에서 문구로 바꾼다.
 * ApiError면 서버가 짚어 준 원인을 쓰고, 그 밖의 실패(네트워크 등)는 동작별로
 * 사용자가 가장 먼저 확인해야 할 입력을 지목한다.
 */
export function mapTeamActionError(
  error: unknown,
  action: ProgramTeamAction,
): string {
  if (error instanceof ApiError) return mapTeamError(error.problem);
  return action === 'create'
    ? TEAM_CREATE_FAILED_MESSAGE
    : TEAM_JOIN_FAILED_MESSAGE;
}

export function applyHrefWithTeam(programId: string, teamId: string): string {
  return `${programHref(programId, '/apply')}?teamId=${encodeURIComponent(teamId)}`;
}

/** `team-invitations/*` 오류 코드(TIV_00N) → 한국어 문구. */
export function mapInvitationError(problem: ProblemDetail): string {
  switch (problem.code) {
    case 'TIV_001':
      return '로그인이 필요합니다.';
    case 'TIV_002':
      return '팀을 찾을 수 없습니다.';
    case 'TIV_003':
      return '팀장만 초대를 관리할 수 있습니다.';
    case 'TIV_004':
      return '팀 구성원만 조회할 수 있습니다.';
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
      return '초대를 찾을 수 없습니다.';
    case 'TIV_011':
      return '이미 처리된 초대입니다.';
    case 'TIV_012':
      return '본인이 받은 초대만 응답할 수 있습니다.';
    case 'TIV_014':
      return '신청 제출 후에는 팀 구성원을 변경할 수 없습니다.';
    default:
      return problem.detail || '초대 요청을 처리하지 못했습니다.';
  }
}
