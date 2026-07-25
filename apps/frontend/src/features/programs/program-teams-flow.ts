import type { ProblemDetail } from '@/lib/api-client';
import type { ProgramTeam } from './api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';
import { programHref } from './program-paths';

export type ProgramTeamsPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'individual'; readonly program: ProgramDetail }
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

export function mapTeamError(problem: ProblemDetail): string {
  switch (problem.code) {
    case 'TEAM_001':
      return '승인된 학생 계정만 팀을 구성할 수 있습니다.';
    case 'TEAM_003':
      return '개인형 프로그램에서는 팀을 구성할 수 없습니다.';
    case 'TEAM_004':
      return '신청 기간이 아닙니다.';
    case 'TEAM_005':
      return '팀 인원 설정이 올바르지 않은 프로그램입니다.';
    case 'TEAM_006':
      return '이미 이 프로그램의 팀에 소속되어 있습니다.';
    case 'TEAM_007':
      return '팀 최대 인원을 초과할 수 없습니다.';
    case 'TEAM_008':
      return '신청 제출 후 팀을 변경할 수 없습니다.';
    case 'TEAM_009':
      return '참여 코드를 찾을 수 없습니다.';
    case 'TEAM_010':
      return '소속된 팀이 없습니다.';
    default:
      return problem.detail || '팀 요청을 처리하지 못했습니다.';
  }
}

export function applyHrefWithTeam(
  programId: string,
  teamId: string,
): string {
  return `${programHref(programId, '/apply')}?teamId=${encodeURIComponent(teamId)}`;
}
