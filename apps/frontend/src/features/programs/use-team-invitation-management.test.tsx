// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import type { ProgramTeam } from './api';
import {
  cancelInvitation,
  createInvitation,
  listSentInvitations,
  searchInvitationCandidates,
  type InvitationCandidate,
  type SentTeamInvitation,
} from './team-invitation-api';
import {
  INVITATION_CANCEL_FAILED_MESSAGE,
  INVITATION_CREATE_FAILED_MESSAGE,
  SENT_INVITATIONS_LOAD_FAILED_MESSAGE,
  useTeamInvitationManagement,
  type TeamInvitationManagement,
  type TeamInvitationManagementInput,
} from './use-team-invitation-management';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('./team-invitation-api', () => ({
  listSentInvitations: vi.fn(),
  searchInvitationCandidates: vi.fn(),
  createInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
}));

const listSentInvitationsMock = vi.mocked(listSentInvitations);
const searchInvitationCandidatesMock = vi.mocked(searchInvitationCandidates);
const createInvitationMock = vi.mocked(createInvitation);
const cancelInvitationMock = vi.mocked(cancelInvitation);

const leaderTeam: ProgramTeam = {
  id: 'team-1',
  name: '오픈소스팀',
  memberCount: 1,
  minMembers: 1,
  maxMembers: 4,
  hasApplication: false,
  canInvite: true,
  canRemoveMembers: true,
  canLeave: true,
  isLeader: true,
  members: [{ userId: 'u1', nickname: 'leader', name: '팀장', isLeader: true }],
};

/** 초대를 받아 합류한 팀원 — 서버가 초대 권한을 주지 않는다. */
const memberTeam: ProgramTeam = {
  ...leaderTeam,
  canInvite: false,
  canRemoveMembers: false,
  isLeader: false,
};

function candidate(id: string, nickname: string): InvitationCandidate {
  return { id, nickname, name: null, avatarUrl: null };
}

function sentInvitation(
  id: string,
  invitee: { readonly nickname: string; readonly name: string | null },
): SentTeamInvitation {
  return {
    id,
    teamId: leaderTeam.id,
    programId: 'program-1',
    invitedById: 'u1',
    status: 'PENDING',
    invitedAt: '2026-07-01T00:00:00.000Z',
    respondedAt: null,
    invitee: {
      id: `user-${id}`,
      nickname: invitee.nickname,
      name: invitee.name,
      avatarUrl: null,
    },
  };
}

function problem(code: string, status = 403): ProblemDetail {
  return {
    type: 'about:blank',
    title: '요청 실패',
    status,
    detail: '',
    instance: 'urn:test:team-invitations',
    code,
  };
}

/** 원하는 시점에 결착시킬 수 있는, 아직 처리되지 않은 요청 응답. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;
let latest: TeamInvitationManagement | null = null;

function Harness(props: TeamInvitationManagementInput) {
  latest = useTeamInvitationManagement(props);
  return null;
}

function current(): TeamInvitationManagement {
  if (latest === null) throw new Error('훅이 아직 렌더링되지 않았다.');
  return latest;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(props: TeamInvitationManagementInput): Promise<void> {
  await act(async () => {
    root.render(<Harness {...props} />);
  });
  await flush();
}

const leaderProps: TeamInvitationManagementInput = {
  programId: 'program-1',
  team: leaderTeam,
  sessionKey: 'synthetic-student',
};

beforeEach(() => {
  vi.useFakeTimers();
  latest = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  listSentInvitationsMock.mockReset().mockResolvedValue([]);
  searchInvitationCandidatesMock.mockReset().mockResolvedValue([]);
  createInvitationMock.mockReset();
  cancelInvitationMock.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useTeamInvitationManagement — 요청 대상', () => {
  it('팀장이 아닌 팀원 화면에서는 보낸 초대를 읽지 않는다', async () => {
    await render({ ...leaderProps, team: memberTeam });

    expect(listSentInvitationsMock).not.toHaveBeenCalled();
    expect(current().sentInvitations).toEqual([]);
    expect(current().sentError).toBeNull();
  });

  it('팀이 없으면 어떤 초대 요청도 보내지 않는다', async () => {
    await render({ ...leaderProps, team: null });

    await act(async () => {
      current().onSearch();
      current().onInvite(candidate('u2', 'octo2'));
      current().onCancelInvitation('inv-1');
      await current().reloadSent();
    });

    expect(listSentInvitationsMock).not.toHaveBeenCalled();
    expect(searchInvitationCandidatesMock).not.toHaveBeenCalled();
    expect(createInvitationMock).not.toHaveBeenCalled();
    expect(cancelInvitationMock).not.toHaveBeenCalled();
  });

  it('세션이 없으면 팀장 팀이라도 요청하지 않는다', async () => {
    await render({ ...leaderProps, sessionKey: null });

    expect(listSentInvitationsMock).not.toHaveBeenCalled();
    expect(current().sentLoading).toBe(false);
  });
});

describe('useTeamInvitationManagement — 보낸 초대', () => {
  it('보낸 초대 실패를 명시적인 오류 상태로 드러낸다', async () => {
    listSentInvitationsMock.mockRejectedValue(new Error('network down'));

    await render(leaderProps);

    expect(current().sentInvitations).toEqual([]);
    expect(current().sentError).toBe(SENT_INVITATIONS_LOAD_FAILED_MESSAGE);
    expect(current().sentLoading).toBe(false);
  });

  it('문제 코드가 있으면 그 원인을 보낸 초대 오류로 보존한다', async () => {
    listSentInvitationsMock.mockRejectedValue(new ApiError(problem('TIV_004')));

    await render(leaderProps);

    expect(current().sentError).toBe(
      '팀 소속이 변경되었습니다. 현재 팀을 다시 확인해 주세요.',
    );
  });

  it('재시도가 성공하면 오류를 지우고 서버 목록을 보여준다', async () => {
    listSentInvitationsMock.mockRejectedValueOnce(new Error('network down'));
    await render(leaderProps);
    expect(current().sentError).not.toBeNull();

    listSentInvitationsMock.mockResolvedValue([
      sentInvitation('inv-1', { nickname: 'octo2', name: '초대받은 사람' }),
    ]);
    await act(async () => {
      current().onRetrySent();
    });
    await flush();

    expect(current().sentError).toBeNull();
    expect(current().sentInvitations.map((item) => item.invitee.name)).toEqual([
      '초대받은 사람',
    ]);
  });

  it('reloadSent 실패는 빈 성공으로 위장하지 않는다', async () => {
    listSentInvitationsMock.mockResolvedValueOnce([
      sentInvitation('inv-1', { nickname: 'octo2', name: null }),
    ]);
    await render(leaderProps);
    expect(current().sentInvitations).toHaveLength(1);

    listSentInvitationsMock.mockRejectedValueOnce(
      new ApiError(problem('TIV_010', 404)),
    );
    await act(async () => {
      await current().reloadSent();
    });
    await flush();

    expect(current().sentError).toBe(
      '초대를 찾을 수 없습니다. 초대 목록을 다시 확인해 주세요.',
    );
  });
});

describe('useTeamInvitationManagement — 신원 경합', () => {
  it('프로그램이 바뀌면 이전 프로그램의 늦은 응답을 반영하지 않는다', async () => {
    const first = deferred<readonly SentTeamInvitation[]>();
    listSentInvitationsMock.mockImplementationOnce(() => first.promise);
    await render(leaderProps);

    listSentInvitationsMock.mockResolvedValue([]);
    await act(async () => {
      root.render(<Harness {...leaderProps} programId="program-2" />);
    });
    await flush();

    await act(async () => {
      first.resolve([
        sentInvitation('stale', { nickname: 'stale', name: null }),
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current().sentInvitations).toEqual([]);
  });

  it('세션이 바뀌면 이전 사용자의 늦은 실패를 화면에 남기지 않는다', async () => {
    const first = deferred<readonly SentTeamInvitation[]>();
    listSentInvitationsMock.mockImplementationOnce(() => first.promise);
    await render(leaderProps);

    listSentInvitationsMock.mockResolvedValue([]);
    await act(async () => {
      root.render(<Harness {...leaderProps} sessionKey="other-student" />);
    });
    await flush();

    await act(async () => {
      first.reject(new Error('stale failure'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current().sentError).toBeNull();
  });

  it('팀장 권한을 잃으면 초대 상태와 진행 표식을 모두 비운다', async () => {
    createInvitationMock.mockImplementation(() => deferred<never>().promise);
    listSentInvitationsMock.mockResolvedValue([
      sentInvitation('inv-1', { nickname: 'octo2', name: null }),
    ]);
    await render(leaderProps);
    await act(async () => {
      current().onInviteQueryChange('octo');
      current().onInvite(candidate('u2', 'octo2'));
    });
    expect(current().invitingUserId).toBe('u2');

    await act(async () => {
      root.render(<Harness {...leaderProps} team={memberTeam} />);
    });
    await flush();

    expect(current().invitingUserId).toBeNull();
    expect(current().inviteQuery).toBe('');
    expect(current().sentInvitations).toEqual([]);
    expect(current().sentError).toBeNull();
  });

  it('팀이 바뀌는 사이 끝난 초대 요청은 새 팀의 진행 표식을 풀지 않는다', async () => {
    const pending = deferred<SentTeamInvitation>();
    createInvitationMock.mockImplementationOnce(() => pending.promise);
    await render(leaderProps);

    await act(async () => {
      current().onInvite(candidate('u2', 'octo2'));
    });
    expect(current().invitingUserId).toBe('u2');

    const nextTeam: ProgramTeam = { ...leaderTeam, id: 'team-2' };
    await act(async () => {
      root.render(<Harness {...leaderProps} team={nextTeam} />);
    });
    await flush();
    expect(current().invitingUserId).toBeNull();

    // 새 팀에서 다시 초대를 시작한 뒤, 이전 팀의 요청이 뒤늦게 실패한다.
    const nextPending = deferred<SentTeamInvitation>();
    createInvitationMock.mockImplementationOnce(() => nextPending.promise);
    await act(async () => {
      current().onInvite(candidate('u3', 'octo3'));
    });
    expect(current().invitingUserId).toBe('u3');

    await act(async () => {
      pending.reject(new ApiError(problem('TIV_009')));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current().invitingUserId).toBe('u3');
    expect(current().inviteActionError).toBeNull();
  });
});

describe('useTeamInvitationManagement — 검색', () => {
  it('입력이 바뀌면 진행 중이던 검색 결과를 버린다', async () => {
    const first = deferred<readonly InvitationCandidate[]>();
    searchInvitationCandidatesMock.mockImplementationOnce(() => first.promise);
    await render(leaderProps);

    await act(async () => {
      current().onInviteQueryChange('aa');
    });
    await act(async () => {
      current().onSearch();
    });
    expect(searchInvitationCandidatesMock).toHaveBeenCalledWith('team-1', 'aa');

    // 2자 미만으로 지워도 진행 중이던 검색은 즉시 무효가 된다.
    await act(async () => {
      current().onInviteQueryChange('a');
    });
    await act(async () => {
      first.resolve([candidate('u9', 'octo9')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current().inviteCandidates).toEqual([]);
    expect(current().searching).toBe(false);
  });

  it('늦게 도착한 이전 검색이 최신 검색 결과를 덮어쓰지 않는다', async () => {
    const first = deferred<readonly InvitationCandidate[]>();
    const second = deferred<readonly InvitationCandidate[]>();
    searchInvitationCandidatesMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    await render(leaderProps);

    await act(async () => {
      current().onInviteQueryChange('aa');
    });
    await act(async () => {
      current().onSearch();
    });
    await act(async () => {
      current().onInviteQueryChange('bb');
    });
    await act(async () => {
      current().onSearch();
    });

    await act(async () => {
      second.resolve([candidate('u2', 'octo2')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current().inviteCandidates.map((item) => item.id)).toEqual(['u2']);

    await act(async () => {
      first.resolve([candidate('u1', 'octo1')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current().inviteCandidates.map((item) => item.id)).toEqual(['u2']);
    expect(current().searchError).toBeNull();
  });

  it('2자 미만 입력은 디바운스가 끝나도 요청하지 않는다', async () => {
    await render(leaderProps);

    await act(async () => {
      current().onInviteQueryChange('a');
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(searchInvitationCandidatesMock).not.toHaveBeenCalled();
  });

  it('디바운스가 끝나면 마지막 입력으로 한 번만 검색한다', async () => {
    searchInvitationCandidatesMock.mockResolvedValue([
      candidate('u9', 'octo9'),
    ]);
    await render(leaderProps);

    await act(async () => {
      current().onInviteQueryChange('oc');
    });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => {
      current().onInviteQueryChange('oct');
    });
    expect(searchInvitationCandidatesMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(searchInvitationCandidatesMock).toHaveBeenCalledTimes(1);
    expect(searchInvitationCandidatesMock).toHaveBeenCalledWith(
      'team-1',
      'oct',
    );
    expect(current().inviteCandidates.map((item) => item.id)).toEqual(['u9']);
  });

  it('검색 실패 원인을 그대로 보여준다', async () => {
    searchInvitationCandidatesMock.mockRejectedValue(
      new ApiError(problem('TIV_003')),
    );
    await render(leaderProps);

    await act(async () => {
      current().onInviteQueryChange('aa');
    });
    await act(async () => {
      current().onSearch();
    });
    await flush();

    expect(current().searchError).toBe('팀장만 초대를 관리할 수 있습니다.');
    expect(current().inviteCandidates).toEqual([]);
    expect(current().searching).toBe(false);
  });
});

describe('useTeamInvitationManagement — 초대 생성·취소', () => {
  it('진행 중인 초대는 연속 클릭에도 한 번만 요청한다', async () => {
    const pending = deferred<SentTeamInvitation>();
    createInvitationMock.mockImplementationOnce(() => pending.promise);
    await render(leaderProps);

    await act(async () => {
      current().onInvite(candidate('u2', 'octo2'));
      current().onInvite(candidate('u2', 'octo2'));
      current().onInvite(candidate('u3', 'octo3'));
    });

    expect(createInvitationMock).toHaveBeenCalledTimes(1);
    expect(createInvitationMock).toHaveBeenCalledWith('team-1', 'u2');
    expect(current().invitingUserId).toBe('u2');
  });

  it('초대에 성공하면 서버의 invitee 표기로 보낸 초대를 갱신한다', async () => {
    createInvitationMock.mockResolvedValue(
      sentInvitation('inv-1', { nickname: 'octo2', name: null }),
    );
    listSentInvitationsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        sentInvitation('inv-1', { nickname: 'octo2', name: '실제 이름' }),
      ]);
    searchInvitationCandidatesMock.mockResolvedValue([]);
    await render(leaderProps);

    await act(async () => {
      current().onInviteQueryChange('octo');
    });
    await act(async () => {
      current().onInvite(candidate('u2', 'octo2'));
    });
    await flush();

    expect(listSentInvitationsMock).toHaveBeenCalledTimes(2);
    expect(current().sentInvitations.map((item) => item.invitee.name)).toEqual([
      '실제 이름',
    ]);
    // 초대 성공 뒤 후보 목록도 현재 검색어로 다시 읽는다.
    expect(searchInvitationCandidatesMock).toHaveBeenCalledWith(
      'team-1',
      'octo',
    );
    expect(current().invitingUserId).toBeNull();
  });

  it('초대 실패를 사용자에게 보여주고 진행 표식을 푼다', async () => {
    createInvitationMock.mockRejectedValue(new Error('network down'));
    await render(leaderProps);

    await act(async () => {
      current().onInvite(candidate('u2', 'octo2'));
    });
    await flush();

    expect(current().inviteActionError).toBe(INVITATION_CREATE_FAILED_MESSAGE);
    expect(current().invitingUserId).toBeNull();

    // 표식이 풀렸으니 같은 후보를 다시 초대할 수 있다.
    createInvitationMock.mockResolvedValue(
      sentInvitation('inv-1', { nickname: 'octo2', name: null }),
    );
    await act(async () => {
      current().onInvite(candidate('u2', 'octo2'));
    });
    await flush();

    expect(createInvitationMock).toHaveBeenCalledTimes(2);
    expect(current().inviteActionError).toBeNull();
  });

  it('초대 취소 실패 원인을 보여준다', async () => {
    cancelInvitationMock.mockRejectedValue(new ApiError(problem('TIV_011')));
    await render(leaderProps);

    await act(async () => {
      current().onCancelInvitation('inv-1');
    });
    await flush();

    expect(current().inviteActionError).toBe(
      '이미 처리된 초대입니다. 초대 목록을 다시 확인해 주세요.',
    );
    expect(current().cancelingInvitationId).toBeNull();
  });

  it('취소에 성공하면 보낸 초대를 다시 읽는다', async () => {
    cancelInvitationMock.mockResolvedValue(undefined);
    listSentInvitationsMock
      .mockResolvedValueOnce([
        sentInvitation('inv-1', { nickname: 'octo2', name: null }),
      ])
      .mockResolvedValueOnce([]);
    await render(leaderProps);

    await act(async () => {
      current().onCancelInvitation('inv-1');
    });
    await flush();

    expect(cancelInvitationMock).toHaveBeenCalledWith('inv-1');
    expect(listSentInvitationsMock).toHaveBeenCalledTimes(2);
    expect(current().sentInvitations).toEqual([]);
    expect(current().inviteActionError).toBeNull();
  });

  it('진행 중인 취소는 연속 클릭에도 한 번만 요청한다', async () => {
    cancelInvitationMock.mockImplementationOnce(() => deferred<void>().promise);
    await render(leaderProps);

    await act(async () => {
      current().onCancelInvitation('inv-1');
      current().onCancelInvitation('inv-1');
    });

    expect(cancelInvitationMock).toHaveBeenCalledTimes(1);
    expect(current().cancelingInvitationId).toBe('inv-1');
  });
});
