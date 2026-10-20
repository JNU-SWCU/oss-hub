import { describe, expect, it } from 'vitest';
import type { ProblemDetail } from '@/lib/api-client';
import {
  mapInvitationError,
  mapTeamActionError,
  mapTeamError,
  TEAM_REQUEST_FAILED_MESSAGE,
} from './program-teams-flow';

function problem(
  code: string,
  detail = '서버가 판정한 요청 실패',
): ProblemDetail {
  return {
    type: 'urn:test:team-management',
    title: '팀 관리 요청 실패',
    status: 409,
    code,
    detail,
    instance: 'urn:test:team-management-request',
  };
}

describe('팀 관리 오류 안내', () => {
  it.each([
    ['TEAM_012', '마지막 팀원은 탈퇴할 수 없습니다'],
    ['TEAM_013', '팀장만 다른 팀원을 제외'],
    ['TEAM_014', '팀 나가기를 통해 탈퇴'],
    ['TEAM_015', '구성원을 찾을 수 없습니다'],
  ])('%s에서 실제로 막힌 동작을 설명한다', (code, text) => {
    expect(mapTeamError(problem(code))).toContain(text);
  });

  it('네트워크 실패를 팀 생성 실패로 오인하지 않는다', () => {
    expect(mapTeamActionError(new Error('synthetic network failure'))).toBe(
      TEAM_REQUEST_FAILED_MESSAGE,
    );
    expect(
      mapTeamActionError(new Error('synthetic network failure')),
    ).not.toContain('팀을 만들지');
  });

  it('팀 소속 변경으로 초대를 보낼 수 없다는 판정을 보존한다', () => {
    expect(mapInvitationError(problem('TIV_004'))).toContain(
      '팀 소속이 변경되었습니다',
    );
  });

  it('알 수 없는 코드는 서버 설명을 보존한다', () => {
    expect(mapTeamError(problem('TEAM_FUTURE', '별도의 요청 조건'))).toBe(
      '별도의 요청 조건',
    );
  });
});
