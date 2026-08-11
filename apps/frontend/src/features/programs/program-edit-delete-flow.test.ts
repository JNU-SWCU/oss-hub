import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  mapProgramDeleteError,
  PROGRAM_DELETE_BLOCKED_CODE,
  PROGRAM_DELETE_FAILED_MESSAGE,
} from './program-edit-delete-flow';
import { programHref } from './program-paths';

function blockedError(blockingCounts: {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
}): ApiError {
  // ApiError의 problem 타입에는 없는 확장 필드(blockingCounts)를 백엔드 ProblemDetail이
  // 얹어 보낸다 — admin-access-api.test.ts의 currentAccess 확장과 같은 패턴이다.
  const problem = {
    type: 'about:blank',
    title: 'Program has blockers',
    status: 409,
    detail: '삭제할 수 없습니다.',
    code: PROGRAM_DELETE_BLOCKED_CODE,
    instance: '/programs/program-1',
    blockingCounts,
  };
  return new ApiError(problem);
}

describe('mapProgramDeleteError', () => {
  // #875 — boardPosts는 staff가 직접 해소할 수 있어 다음 행동(게시판 이동)을 알려준다.
  it('boardPosts만 남았으면 게시판으로 이동하라는 문구와 링크를 만든다', () => {
    const result = mapProgramDeleteError(
      blockedError({
        applications: 0,
        teams: 0,
        submissions: 0,
        boardPosts: 3,
      }),
      'program-1',
    );

    expect(result).toEqual({
      kind: 'blocked',
      messages: [
        {
          text: '게시글 3개가 남아 있습니다. 게시판에서 지운 뒤 다시 시도하세요.',
          boardHref: programHref('program-1', '/board'),
        },
      ],
    });
  });

  // applications/teams는 학생 데이터라 staff가 지울 방법이 없다 — 사실만 말하고
  // 다음 행동(call-to-action)은 주지 않는다.
  it('applications만 남았으면 사실만 말하고 다음 행동은 말하지 않는다', () => {
    const result = mapProgramDeleteError(
      blockedError({
        applications: 5,
        teams: 0,
        submissions: 0,
        boardPosts: 0,
      }),
      'program-1',
    );

    expect(result).toEqual({
      kind: 'blocked',
      messages: [
        {
          text: '신청 5건이 남아 있습니다. 학생 데이터가 있는 프로그램은 지울 수 없습니다.',
        },
      ],
    });
  });

  it('teams만 남았으면 사실만 말한다', () => {
    const result = mapProgramDeleteError(
      blockedError({
        applications: 0,
        teams: 2,
        submissions: 0,
        boardPosts: 0,
      }),
      'program-1',
    );

    expect(result).toEqual({
      kind: 'blocked',
      messages: [
        {
          text: '팀 2개가 남아 있습니다. 학생 데이터가 있는 프로그램은 지울 수 없습니다.',
        },
      ],
    });
  });

  it('applications와 teams가 함께 남았으면 두 건수를 한 문장에 합친다', () => {
    const result = mapProgramDeleteError(
      blockedError({
        applications: 5,
        teams: 2,
        submissions: 0,
        boardPosts: 0,
      }),
      'program-1',
    );

    expect(result).toEqual({
      kind: 'blocked',
      messages: [
        {
          text: '신청 5건 / 팀 2개가 남아 있습니다. 학생 데이터가 있는 프로그램은 지울 수 없습니다.',
        },
      ],
    });
  });

  it('네 카테고리가 모두 있으면 boardPosts 문구와 applications/teams 문구를 함께 만든다', () => {
    const result = mapProgramDeleteError(
      blockedError({
        applications: 1,
        teams: 1,
        submissions: 1,
        boardPosts: 1,
      }),
      'program-1',
    );

    expect(result.kind).toBe('blocked');
    if (result.kind !== 'blocked') throw new Error('unreachable');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.text).toContain('게시글 1개');
    expect(result.messages[1]?.text).toContain('신청 1건 / 팀 1개');
    // submissions는 방어적으로만 세고 별도 문구를 만들지 않는다.
    expect(result.messages.some((m) => m.text.includes('제출물'))).toBe(false);
  });

  it('409가 아니거나 코드가 다르면 백엔드 detail을 그대로 보여준다', () => {
    const error = new ApiError({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: '권한이 없습니다.',
      code: 'PRG_999',
      instance: '/programs/program-1',
    });

    expect(mapProgramDeleteError(error, 'program-1')).toEqual({
      kind: 'generic',
      message: '권한이 없습니다.',
    });
  });

  it('409·PRG_012인데 blockingCounts가 없거나 형태가 다르면 일반 실패 메시지로 되돌아간다', () => {
    const error = new ApiError({
      type: 'about:blank',
      title: 'Program has blockers',
      status: 409,
      detail: '',
      code: PROGRAM_DELETE_BLOCKED_CODE,
      instance: '/programs/program-1',
    });

    expect(mapProgramDeleteError(error, 'program-1')).toEqual({
      kind: 'generic',
      message: PROGRAM_DELETE_FAILED_MESSAGE,
    });
  });

  it('ApiError가 아니면(네트워크 오류 등) 일반 실패 메시지로 되돌아간다', () => {
    expect(
      mapProgramDeleteError(new TypeError('network'), 'program-1'),
    ).toEqual({
      kind: 'generic',
      message: PROGRAM_DELETE_FAILED_MESSAGE,
    });
  });
});
