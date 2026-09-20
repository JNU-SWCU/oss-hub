import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  formatTeamDeletedCounts,
  teamDeleteErrorMessage,
  teamDeleteScopeChangedCounts,
  TEAM_DELETE_FAILED_MESSAGE,
  TEAM_DELETE_SCOPE_CHANGED_CODE,
} from './team-delete-flow';

const currentTeamScopeCounts = {
  applications: 1,
  members: 3,
  invitations: 0,
  submissions: 2,
  submissionEvents: 4,
  detachedRepositories: 1,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
};

function scopeChangedError(
  extra: Record<string, unknown> = { currentTeamScopeCounts },
): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Team scope changed',
    status: 409,
    detail: '',
    code: TEAM_DELETE_SCOPE_CHANGED_CODE,
    instance: '/programs/program-1/teams/team-1',
    ...extra,
  });
}

describe('teamDeleteScopeChangedCounts', () => {
  it('409·TEAM_019의 currentTeamScopeCounts를 그대로 반환한다', () => {
    expect(teamDeleteScopeChangedCounts(scopeChangedError())).toEqual(
      currentTeamScopeCounts,
    );
  });

  it('다른 코드이거나 currentTeamScopeCounts가 없으면 null을 반환한다', () => {
    expect(
      teamDeleteScopeChangedCounts(
        new ApiError({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: '',
          code: 'TEAM_018',
          instance: '/programs/program-1/teams/team-1',
        }),
      ),
    ).toBeNull();
    expect(teamDeleteScopeChangedCounts(scopeChangedError({}))).toBeNull();
    expect(teamDeleteScopeChangedCounts(new Error('boom'))).toBeNull();
  });

  it('숫자 칸이 하나라도 아니거나 fingerprint가 문자열이 아니면 버린다', () => {
    expect(
      teamDeleteScopeChangedCounts(
        scopeChangedError({
          currentTeamScopeCounts: {
            ...currentTeamScopeCounts,
            members: '3',
          },
        }),
      ),
    ).toBeNull();
    expect(
      teamDeleteScopeChangedCounts(
        scopeChangedError({
          currentTeamScopeCounts: {
            ...currentTeamScopeCounts,
            applications: Number.NaN,
          },
        }),
      ),
    ).toBeNull();
    expect(
      teamDeleteScopeChangedCounts(
        scopeChangedError({
          currentTeamScopeCounts: {
            ...currentTeamScopeCounts,
            scopeFingerprint: 12,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('teamDeleteErrorMessage', () => {
  it('서버 detail이 있으면 그대로 보여준다', () => {
    expect(
      teamDeleteErrorMessage(
        new ApiError({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: '교직원만 팀을 삭제할 수 있습니다.',
          code: 'TEAM_018',
          instance: '/programs/program-1/teams/team-1',
        }),
      ),
    ).toBe('교직원만 팀을 삭제할 수 있습니다.');
  });

  it('detail이 비었거나 API 오류가 아니면 일반 실패 문장으로 떨어진다', () => {
    expect(
      teamDeleteErrorMessage(
        new ApiError({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: '',
          code: 'TEAM_017',
          instance: '/programs/program-1/teams/team-1',
        }),
      ),
    ).toBe(TEAM_DELETE_FAILED_MESSAGE);
    expect(teamDeleteErrorMessage(new Error('boom'))).toBe(
      TEAM_DELETE_FAILED_MESSAGE,
    );
  });
});

describe('formatTeamDeletedCounts', () => {
  it('0건은 빼고 한국어 요약을 만든다', () => {
    expect(
      formatTeamDeletedCounts({
        applications: 1,
        members: 3,
        invitations: 0,
        submissions: 0,
        submissionEvents: 0,
        detachedRepositories: 1,
      }),
    ).toBe('지원서 1건 · 팀원 3명 · 저장소 연결 해제 1건');
  });

  it('전부 0이면 연결된 데이터가 없었다고 말한다', () => {
    expect(
      formatTeamDeletedCounts({
        applications: 0,
        members: 0,
        invitations: 0,
        submissions: 0,
        submissionEvents: 0,
        detachedRepositories: 0,
      }),
    ).toBe('연결된 데이터가 없었습니다.');
  });
});
