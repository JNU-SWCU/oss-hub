import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  mapProgramDeleteError,
  purgeScopeChangedCounts,
  PROGRAM_DELETE_BLOCKED_CODE,
  PROGRAM_DELETE_FAILED_MESSAGE,
  PROGRAM_PURGE_SCOPE_CHANGED_CODE,
} from './program-edit-delete-flow';

function blockedError(blockingCounts: {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
}): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Program has blockers',
    status: 409,
    detail: '삭제할 수 없습니다.',
    code: PROGRAM_DELETE_BLOCKED_CODE,
    instance: '/programs/program-1',
    ...{ blockingCounts },
  });
}

describe('mapProgramDeleteError', () => {
  it('409 차단 건수를 실제 교직원 관리 화면 링크와 함께 보존한다', () => {
    expect(
      mapProgramDeleteError(
        blockedError({
          applications: 1,
          teams: 2,
          submissions: 3,
          boardPosts: 4,
        }),
        'program:1',
      ),
    ).toEqual({
      kind: 'blocked',
      counts: { applications: 1, teams: 2, submissions: 3, boardPosts: 4 },
      items: [
        {
          label: '지원서',
          count: 1,
          unit: '건',
          href: '/programs/program%3A1/applicants',
        },
        {
          label: '팀',
          count: 2,
          unit: '개',
          href: '/programs/program%3A1/teams',
        },
        {
          label: '게시글',
          count: 4,
          unit: '건',
          href: '/programs/program%3A1/board',
        },
        {
          label: '제출물',
          count: 3,
          unit: '건',
          href: '/programs/program%3A1/status',
        },
      ],
    });
  });

  it('0건 항목은 요약과 링크에서 제외한다', () => {
    const result = mapProgramDeleteError(
      blockedError({
        applications: 0,
        teams: 0,
        submissions: 0,
        boardPosts: 2,
      }),
      'program-1',
    );

    expect(result).toEqual({
      kind: 'blocked',
      counts: { applications: 0, teams: 0, submissions: 0, boardPosts: 2 },
      items: [
        {
          label: '게시글',
          count: 2,
          unit: '건',
          href: '/programs/program-1/board',
        },
      ],
    });
  });

  it('409·PRG_012에 blockingCounts가 없으면 일반 실패 메시지로 되돌아간다', () => {
    expect(
      mapProgramDeleteError(
        new ApiError({
          type: 'about:blank',
          title: 'Program has blockers',
          status: 409,
          detail: '',
          code: PROGRAM_DELETE_BLOCKED_CODE,
          instance: '/programs/program-1',
        }),
        'program-1',
      ),
    ).toEqual({ kind: 'generic', message: PROGRAM_DELETE_FAILED_MESSAGE });
  });

  it('다른 API 오류는 서버 상세 메시지를 보여준다', () => {
    expect(
      mapProgramDeleteError(
        new ApiError({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: '권한이 없습니다.',
          code: 'PRG_011',
          instance: '/programs/program-1',
        }),
        'program-1',
      ),
    ).toEqual({ kind: 'generic', message: '권한이 없습니다.' });
  });
});

describe('purgeScopeChangedCounts', () => {
  it('409·PRG_014의 currentScopeCounts를 그대로 반환한다', () => {
    const currentScopeCounts = {
      applications: 6,
      teams: 7,
      boardPosts: 8,
      submissions: 9,
    };
    expect(
      purgeScopeChangedCounts(
        new ApiError({
          type: 'about:blank',
          title: 'Purge scope changed',
          status: 409,
          detail: '',
          code: PROGRAM_PURGE_SCOPE_CHANGED_CODE,
          instance: '/programs/program-1/purge',
          ...{ currentScopeCounts },
        }),
      ),
    ).toEqual(currentScopeCounts);
  });

  it('다른 코드이거나 currentScopeCounts가 없으면 null을 반환한다', () => {
    expect(
      purgeScopeChangedCounts(
        new ApiError({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          detail: '',
          code: 'PRG_011',
          instance: '/programs/program-1/purge',
        }),
      ),
    ).toBeNull();
    expect(
      purgeScopeChangedCounts(
        new ApiError({
          type: 'about:blank',
          title: 'Purge scope changed',
          status: 409,
          detail: '',
          code: PROGRAM_PURGE_SCOPE_CHANGED_CODE,
          instance: '/programs/program-1/purge',
        }),
      ),
    ).toBeNull();
    expect(purgeScopeChangedCounts(new Error('boom'))).toBeNull();
  });
});
