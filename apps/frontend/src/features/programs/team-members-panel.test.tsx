import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  TeamMembersPanel,
  type TeamMembersPanelMode,
} from './team-members-panel';
import { removeMyTeamMember, type ProgramTeam } from './api';
import type { SentTeamInvitation } from './team-invitation-api';
import type { TeamInvitationManagement } from './use-team-invitation-management';

vi.mock('./api', () => ({ removeMyTeamMember: vi.fn() }));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const team: ProgramTeam = {
  id: 'team-1',
  name: '합성 팀',
  memberCount: 3,
  minMembers: 2,
  maxMembers: 4,
  hasApplication: false,
  canInvite: true,
  canRemoveMembers: true,
  canLeave: true,
  isLeader: true,
  members: [
    {
      userId: 'member-1',
      nickname: 'synthetic-member',
      name: '먼저 합류',
      isLeader: false,
    },
    {
      userId: 'leader-1',
      nickname: 'synthetic-leader',
      name: null,
      isLeader: true,
    },
    {
      userId: 'member-2',
      nickname: 'later-member',
      name: '나중 합류',
      isLeader: false,
    },
  ],
};

function sentInvitation(
  overrides: Partial<SentTeamInvitation> = {},
): SentTeamInvitation {
  return {
    id: 'inv-1',
    teamId: 'team-1',
    programId: 'program-1',
    invitedById: 'leader-1',
    status: 'PENDING',
    invitedAt: '2026-07-01T00:00:00Z',
    respondedAt: null,
    invitee: {
      id: 'user-1',
      nickname: 'synthetic-one',
      name: '합성 초대 대상',
      avatarUrl: null,
    },
    ...overrides,
  };
}

const onCancelInvitation = vi.fn();
const onRetrySent = vi.fn();
const onSearch = vi.fn();
const onInvite = vi.fn();
const onInviteQueryChange = vi.fn();

function invitationManagement(
  overrides: Partial<TeamInvitationManagement> = {},
): TeamInvitationManagement {
  return {
    sentInvitations: [],
    sentLoading: false,
    inviteQuery: '',
    inviteCandidates: [],
    searching: false,
    searchError: null,
    invitingUserId: null,
    cancelingInvitationId: null,
    inviteActionError: null,
    sentError: null,
    onRetrySent,
    onInviteQueryChange,
    onSearch,
    onInvite,
    onCancelInvitation,
    reloadSent: async () => undefined,
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;
const onChanged = vi.fn();
const onOpenInvite = vi.fn();
const inviteTriggerRef: { current: HTMLButtonElement | null } = {
  current: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  inviteTriggerRef.current = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

interface RenderOptions {
  readonly team?: ProgramTeam | null;
  readonly sessionNickname?: string;
  readonly mode?: TeamMembersPanelMode;
  readonly invitation?: TeamInvitationManagement | null;

  readonly inviteEntry?: null;
}

async function render(
  overrides: Partial<ProgramTeam> = {},
  sessionNickname = 'synthetic-leader',
  options: RenderOptions = {},
) {
  const nextTeam =
    options.team === null ? null : { ...team, ...overrides, ...options.team };
  await act(async () =>
    root.render(
      <TeamMembersPanel
        programId="program-1"
        team={nextTeam}
        sessionNickname={options.sessionNickname ?? sessionNickname}
        mode={options.mode ?? 'manage'}
        invitation={
          options.invitation === undefined
            ? invitationManagement()
            : options.invitation
        }
        onOpenInvite={options.inviteEntry === null ? null : onOpenInvite}
        inviteTriggerRef={
          options.inviteEntry === null ? null : inviteTriggerRef
        }
        onChanged={onChanged}
      />,
    ),
  );
}

function listRows(): readonly HTMLLIElement[] {
  const list = host.querySelector('ul[aria-label="팀 구성원과 초대"]');
  return Array.from(list?.querySelectorAll('li') ?? []);
}

function rosterRows(): readonly HTMLLIElement[] {
  return listRows().filter(
    (row) => !(row.textContent ?? '').includes('초대 대기'),
  );
}

function pendingRows(): readonly HTMLLIElement[] {
  return listRows().filter((row) =>
    (row.textContent ?? '').includes('초대 대기'),
  );
}

function removeButtons(): readonly HTMLButtonElement[] {
  return Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label$="팀에서 제외"]',
    ),
  );
}

function inviteTrigger(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    'button[aria-label="팀원 초대"]',
  );
}

function dialogButton(text: string): HTMLButtonElement {
  const scope = document.querySelector('[role="alertdialog"]');
  if (!scope) throw new Error('확인 레이어 없음');
  const found = Array.from(scope.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
  if (!found) throw new Error(`버튼 없음: ${text}`);
  return found;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function dialog(): Element | null {
  return document.querySelector('[role="alertdialog"]');
}

function apiError(code: string, detail: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: '요청 처리 실패',
    status: 409,
    detail,
    instance: 'urn:test:team-member-removal',
    code,
  });
}

describe('TeamMembersPanel', () => {
  it('팀장을 맨 위에 두고 인원수와 이름을 중복 없이 보여 준다', async () => {
    await render();
    expect(host.textContent).toContain('팀원 3명');
    expect(host.textContent).toContain('최소 2명 · 최대 4명');
    const text = rosterRows().map((row) => row.textContent ?? '');
    expect(text[0]).toContain('팀장');
    expect(text[0]).toContain('synthetic-leader');

    expect(text[0]?.split('synthetic-leader').length).toBe(2);
    expect(text[1]).toContain('먼저 합류');
    expect(text[2]).toContain('나중 합류');
  });

  it('팀장은 자기 행과 팀장 행을 뺀 다른 팀원만 제외할 수 있다', async () => {
    vi.mocked(removeMyTeamMember).mockResolvedValue(undefined);
    await render();
    expect(
      removeButtons().map((item) => item.getAttribute('aria-label')),
    ).toEqual(['먼저 합류 팀에서 제외', '나중 합류 팀에서 제외']);
    expect(rosterRows()[0]?.querySelector('button')).toBeNull();

    await act(async () => removeButtons()[0]?.click());

    expect(removeMyTeamMember).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => dialogButton('팀에서 제외').click());
    expect(removeMyTeamMember).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'member-1',
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('제외가 무엇을 지우는지 확인 레이어에서 밝힌다', async () => {
    await render();
    await act(async () => removeButtons()[0]?.click());
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('팀 구성원 목록에서만 빠집니다');
    expect(dialog?.textContent).toContain(
      '이미 제출한 신청서와 제출 기록은 그대로 남고',
    );
    expect(dialog?.textContent).toContain(
      '계정과 다른 프로그램 참여에는 영향이 없습니다',
    );
  });

  it('서버가 제외 권한을 주지 않으면 팀장 표기와 무관하게 버튼이 없다', async () => {
    await render({ canRemoveMembers: false });
    expect(removeButtons()).toHaveLength(0);
    expect(removeMyTeamMember).not.toHaveBeenCalled();
  });

  it('팀원 화면에는 제외 버튼이 아예 없다', async () => {
    await render(
      { isLeader: false, canInvite: false, canRemoveMembers: false },
      'synthetic-member',
    );
    expect(removeButtons()).toHaveLength(0);
  });

  it('서버가 제외 권한을 줌에도 지금 계정 본인 행에는 붙이지 않는다', async () => {
    await render({}, 'synthetic-member');
    expect(
      removeButtons().map((item) => item.getAttribute('aria-label')),
    ).toEqual(['나중 합류 팀에서 제외']);
  });

  it('실패하면 거절 원인을 보여 주고 목록을 갱신하지 않는다', async () => {
    vi.mocked(removeMyTeamMember)
      .mockRejectedValueOnce(
        apiError('TEAM_015', '해당 팀원을 찾을 수 없습니다.'),
      )
      .mockResolvedValueOnce(undefined);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    expect(onChanged).not.toHaveBeenCalled();

    expect(document.body.textContent).toContain(
      '이 팀의 구성원을 찾을 수 없습니다. 팀 현황을 다시 확인해 주세요.',
    );
    expect(host.textContent).not.toContain('잠시 후 다시 시도해 주세요');

    await act(async () => dialogButton('팀에서 제외').click());
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('서버 문구가 없는 코드에서는 서버가 보낸 detail을 그대로 살린다', async () => {
    vi.mocked(removeMyTeamMember).mockRejectedValue(
      apiError('TEAM_999', '알 수 없는 이유로 거절되었습니다.'),
    );
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    expect(document.body.textContent).toContain(
      '알 수 없는 이유로 거절되었습니다.',
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('처리 중에는 중복 제외와 닫기를 막는다', async () => {
    let resolve!: () => void;
    vi.mocked(removeMyTeamMember).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    expect(dialogButton('처리 중…').disabled).toBe(true);
    expect(dialogButton('취소').disabled).toBe(true);
    expect(removeButtons().every((item) => item.disabled)).toBe(true);
    expect(removeMyTeamMember).toHaveBeenCalledOnce();
    await act(async () => resolve());
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('응답을 기다리는 사이 로그인 계정이 바뀌면 그 결과를 반영하지 않는다', async () => {
    let resolve!: () => void;
    vi.mocked(removeMyTeamMember).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());

    await render({}, 'other-account');
    await act(async () => resolve());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('응답을 기다리는 사이 팀장 권한이 사라지면 그 결과를 반영하지 않는다', async () => {
    let resolve!: () => void;
    vi.mocked(removeMyTeamMember).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    await render({ canRemoveMembers: false, isLeader: false });
    await act(async () => resolve());
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('TeamMembersPanel — 초대 시작', () => {
  it('초대 아이콘은 이름표와 설명을 갖고, 누르면 화면의 준비 절차만 부른다', async () => {
    await render();
    const plus = inviteTrigger();
    expect(plus).not.toBeNull();
    expect(plus?.getAttribute('aria-haspopup')).toBe('dialog');

    expect(inviteTriggerRef.current).toBe(plus);

    expect(plus?.className).toContain('h-control');
    expect(plus?.className).toContain('w-control');

    await act(async () => plus?.click());
    expect(onOpenInvite).toHaveBeenCalledOnce();
    expect(removeMyTeamMember).not.toHaveBeenCalled();
  });

  it('초대 권한이 없는 팀원 화면에는 초대 시작 자체가 없다', async () => {
    await render(
      { canInvite: false, canRemoveMembers: false, isLeader: false },
      'synthetic-member',
    );
    expect(inviteTrigger()).toBeNull();
  });

  it('초대 진입점을 받지 못한 표면은 서버가 권한을 줘도 초대를 그리지 않는다', async () => {
    await render({ canInvite: true }, 'synthetic-leader', {
      inviteEntry: null,
    });
    expect(inviteTrigger()).toBeNull();
    expect(onOpenInvite).not.toHaveBeenCalled();
  });

  it('팀이 없어 초대 상태가 없어도 초대 시작은 살아 있다', async () => {
    await render({}, 'synthetic-leader', {
      team: null,
      invitation: null,
    });
    const plus = inviteTrigger();
    expect(plus).not.toBeNull();
    await act(async () => plus?.click());
    expect(onOpenInvite).toHaveBeenCalledOnce();
  });
});

describe('TeamMembersPanel — 팀 없음', () => {
  it('내 닉네임만 예정으로 보여 주고 아무 것도 쓰지 않는다', async () => {
    await render({}, 'synthetic-leader', { team: null, invitation: null });
    expect(rosterRows()).toHaveLength(1);
    expect(rosterRows()[0]?.textContent).toContain('synthetic-leader');

    expect(rosterRows()[0]?.textContent).toContain('팀장 예정');

    expect(host.textContent).not.toContain('팀을 만들면');
    expect(host.textContent).not.toContain('아직 만들어지지 않았습니다');
    expect(host.textContent).not.toContain('/4명');
    expect(removeButtons()).toHaveLength(0);
    expect(removeMyTeamMember).not.toHaveBeenCalled();
  });

  it('초대 상태가 없으면 보낸 초대 오류·로딩 자리도 만들지 않는다', async () => {
    await render({}, 'synthetic-leader', { team: null, invitation: null });
    expect(host.textContent).not.toContain('보낸 초대를 불러오는 중');
    expect(host.textContent).not.toContain('보낸 초대를 불러오지 못했습니다');
    expect(pendingRows()).toHaveLength(0);
  });
});

describe('TeamMembersPanel — 초대 대기', () => {
  it('대기 초대를 팀원과 구분해 보여 주고 인원수에 섞지 않는다', async () => {
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [
          sentInvitation(),
          sentInvitation({
            id: 'inv-2',
            status: 'ACCEPTED',
            respondedAt: '2026-07-02T00:00:00Z',
            invitee: {
              id: 'user-2',
              nickname: 'synthetic-two',
              name: null,
              avatarUrl: null,
            },
          }),
        ],
      }),
    });

    expect(pendingRows()).toHaveLength(1);
    expect(pendingRows()[0]?.textContent).toContain('합성 초대 대상');
    expect(pendingRows()[0]?.textContent).toContain('synthetic-one');
    expect(pendingRows()[0]?.textContent).toContain('초대 대기');
    expect(rosterRows()).toHaveLength(3);
    expect(host.textContent).toContain('팀원 3명');

    expect(host.textContent).not.toContain('보낸 초대가 없습니다');

    expect(host.querySelectorAll('ul')).toHaveLength(1);
    expect(listRows()).toHaveLength(4);

    expect(listRows()[3]?.textContent).toContain('초대 대기');

    const list = host.querySelector('ul[aria-label="팀 구성원과 초대"]');
    expect(list?.className).toContain('[&>li+li]:border-t');
    expect(list?.className).toContain('[&>li+li]:border-border/50');
  });

  it('이미 합류한 사람의 대기 초대는 같은 목록에 두 번 내지 않는다', async () => {
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [
          sentInvitation({
            id: 'inv-stale',
            invitee: {
              id: 'member-1',
              nickname: 'synthetic-member',
              name: '먼저 합류',
              avatarUrl: null,
            },
          }),
          sentInvitation(),
        ],
      }),
    });
    expect(pendingRows()).toHaveLength(1);
    expect(pendingRows()[0]?.textContent).toContain('합성 초대 대상');
    expect(
      host.querySelector('button[aria-label="먼저 합류 초대 취소"]'),
    ).toBeNull();

    expect(rosterRows()).toHaveLength(3);
  });

  it('대기 초대는 이름표가 붙은 아이콘 하나로 취소한다', async () => {
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [sentInvitation()],
      }),
    });
    const cancel = host.querySelector<HTMLButtonElement>(
      'button[aria-label="합성 초대 대상 초대 취소"]',
    );
    expect(cancel).not.toBeNull();
    expect(cancel?.textContent).toBe('');
    await act(async () => cancel?.click());
    expect(onCancelInvitation).toHaveBeenCalledExactlyOnceWith('inv-1');
  });

  it('취소가 도는 동안 그 행의 조작만 잠근다', async () => {
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [
          sentInvitation(),
          sentInvitation({
            id: 'inv-2',
            invitee: {
              id: 'user-2',
              nickname: 'synthetic-two',
              name: null,
              avatarUrl: null,
            },
          }),
        ],
        cancelingInvitationId: 'inv-1',
      }),
    });
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        'button[aria-label$="초대 취소"]',
      ),
    );
    expect(buttons.map((item) => item.disabled)).toEqual([true, false]);
  });

  it('취소 실패를 확인 레이어 없이 목록에서 밝히고 같은 취소를 다시 건다', async () => {
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [sentInvitation()],
      }),
    });
    const cancel = host.querySelector<HTMLButtonElement>(
      'button[aria-label="합성 초대 대상 초대 취소"]',
    );
    await act(async () => cancel?.click());
    expect(onCancelInvitation).toHaveBeenCalledExactlyOnceWith('inv-1');

    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [sentInvitation()],
        inviteActionError: '이미 응답한 초대는 취소할 수 없습니다.',
      }),
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.textContent).toContain('초대 취소 실패');
    expect(host.textContent).toContain(
      '이미 응답한 초대는 취소할 수 없습니다.',
    );

    const retry = Array.from(host.querySelectorAll('button')).find(
      (item) => item.textContent === '다시 시도',
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(onCancelInvitation).toHaveBeenCalledTimes(2);
    expect(onCancelInvitation).toHaveBeenLastCalledWith('inv-1');

    expect(
      host.querySelector<HTMLButtonElement>(
        'button[aria-label="합성 초대 대상 초대 취소"]',
      )?.disabled,
    ).toBe(false);
    expect(removeButtons()).toHaveLength(2);
    expect(pendingRows()).toHaveLength(1);
  });

  it('취소를 건 적 없는 실패는 내용만 밝히고 취소 재시도를 지어내지 않는다', async () => {
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [sentInvitation()],
        inviteActionError: '팀 최대 인원을 초과할 수 없습니다.',
      }),
    });
    expect(host.textContent).toContain('팀 최대 인원을 초과할 수 없습니다.');
    expect(host.textContent).not.toContain('초대 취소 실패');
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (item) => item.textContent === '다시 시도',
      ),
    ).toBe(false);
    expect(onCancelInvitation).not.toHaveBeenCalled();
  });

  it('보낸 초대를 불러오는 중과 실패·재시도를 목록 안에서 표면화한다', async () => {
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({ sentLoading: true }),
    });
    expect(host.textContent).toContain('보낸 초대를 불러오는 중…');

    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentError:
          '보낸 초대를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      }),
    });
    expect(host.textContent).toContain('보낸 초대를 불러오지 못했습니다');
    const retry = Array.from(host.querySelectorAll('button')).find(
      (item) => item.textContent === '다시 시도',
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(onRetrySent).toHaveBeenCalledOnce();
  });
});

describe('TeamMembersPanel — 화면 모드', () => {
  it('compose에서는 서버가 제외 권한을 주더라도 제외를 그리지 않는다', async () => {
    await render({}, 'synthetic-leader', { mode: 'compose' });
    expect(removeButtons()).toHaveLength(0);
    expect(removeMyTeamMember).not.toHaveBeenCalled();

    expect(inviteTrigger()).not.toBeNull();
  });

  it('manage에서는 같은 팀이 제외를 다시 갖는다', async () => {
    await render({}, 'synthetic-leader', { mode: 'manage' });
    expect(removeButtons()).toHaveLength(2);
  });
});

describe('TeamMembersPanel — 신원 경계', () => {
  it('세션이 바뀌면 앞 계정의 확인 레이어·진행 표식을 그 자리에서 버린다', async () => {
    const first = deferred();
    vi.mocked(removeMyTeamMember).mockReturnValueOnce(first.promise);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    expect(dialog()).not.toBeNull();

    await render({}, 'other-leader');

    expect(dialog()).toBeNull();
    expect(host.textContent).not.toContain('팀에서 제외 실패');
    expect(removeButtons()).toHaveLength(2);
    expect(removeButtons().some((item) => item.disabled)).toBe(false);
  });

  it('앞 계정의 늦은 성공은 새 계정의 진행을 끝내거나 콜백을 부르지 못한다', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(removeMyTeamMember)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    await render({}, 'other-leader');

    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    expect(removeMyTeamMember).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve());

    expect(onChanged).not.toHaveBeenCalled();
    expect(dialogButton('처리 중…').disabled).toBe(true);
    expect(host.textContent).not.toContain('팀에서 제외 실패');

    await act(async () => second.resolve());
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('앞 계정의 늦은 실패는 새 계정의 오류로 새지 않는다', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(removeMyTeamMember)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    await render({}, 'other-leader');
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());

    await act(async () =>
      first.reject(
        apiError('TEAM_013', '팀장만 다른 팀원을 제외할 수 있습니다.'),
      ),
    );

    expect(host.textContent).not.toContain('팀에서 제외 실패');
    expect(dialogButton('처리 중…').disabled).toBe(true);
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => second.resolve());
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('팀이 바뀌는 사이 끝난 요청은 새 팀의 화면을 건드리지 못한다', async () => {
    const first = deferred();
    vi.mocked(removeMyTeamMember).mockReturnValueOnce(first.promise);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());

    await render({ id: 'team-2', name: '새 팀' });

    expect(dialog()).toBeNull();
    expect(removeButtons().some((item) => item.disabled)).toBe(false);
    await act(async () => first.resolve());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('제외 권한이 바뀌는 사이 끝난 요청도 같이 버려진다', async () => {
    const first = deferred();
    vi.mocked(removeMyTeamMember).mockReturnValueOnce(first.promise);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());

    await render({ canRemoveMembers: false });

    expect(dialog()).toBeNull();
    expect(removeButtons()).toHaveLength(0);
    await act(async () => first.resolve());
    expect(onChanged).not.toHaveBeenCalled();

    await render({ canRemoveMembers: true });
    expect(dialog()).toBeNull();
    expect(host.textContent).not.toContain('팀에서 제외 실패');
    expect(removeButtons().some((item) => item.disabled)).toBe(false);
  });

  it('화면 모드가 바뀌면 앞 모드의 확인 레이어를 물려받지 않는다', async () => {
    const first = deferred();
    vi.mocked(removeMyTeamMember).mockReturnValueOnce(first.promise);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());

    await render({}, 'synthetic-leader', { mode: 'compose' });

    expect(dialog()).toBeNull();
    await act(async () => first.resolve());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
