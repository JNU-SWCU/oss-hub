// @vitest-environment happy-dom
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

/**
 * 백엔드 순서를 일부러 팀장이 가운데 오도록 둔다 — 화면이 팀장을 맨 위로 올리되
 * 나머지 순서는 서버가 준 그대로 유지하는지 보기 위해서다.
 */
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
  // `clearAllMocks`는 호출 기록만 지우고 `mockResolvedValueOnce` 큐는 남긴다 — 앞
  // 테스트가 중간에 끊기면 쓰이지 않은 큐가 다음 테스트의 응답을 가로채,
  // 진행 중이어야 할 요청이 곧바로 끝나 확인 레이어가 사라졌다. 구현까지 초기화한다.
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
  /** 초대 진입점이 없는 표면(제출된 신청서 보기 등)은 두 값을 모두 null로 준다. */
  readonly inviteEntry?: null;
}

/** 로그인을 확인한 라우트가 넣어 주는 계정 — 기본값은 팀장 본인이다. */
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

/** 팀원과 대기 중인 초대는 하나의 목록이다 — 구분은 행 안의 표시가 맡는다. */
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

/** 행의 제외 조작은 아이콘이라 이름표(aria-label)로만 식별한다. */
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
  const scope = host.querySelector('[role="alertdialog"]');
  if (!scope) throw new Error('확인 레이어 없음');
  const found = Array.from(scope.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
  if (!found) throw new Error(`버튼 없음: ${text}`);
  return found as HTMLButtonElement;
}

/** 끝나는 시점을 테스트가 잡는 요청. */
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
  return host.querySelector('[role="alertdialog"]');
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
    // 이름이 없으면 닉네임 하나만 — 같은 값을 두 번 그리지 않는다.
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
    // 확인 전에는 아무것도 지우지 않는다.
    expect(removeMyTeamMember).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();

    await act(async () => dialogButton('팀에서 제외').click());
    expect(removeMyTeamMember).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'member-1',
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('제외가 무엇을 지우는지 확인 레이어에서 밝힌다', async () => {
    await render();
    await act(async () => removeButtons()[0]?.click());
    const dialog = host.querySelector('[role="alertdialog"]');
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
    // 팀장이 아닌 계정이 제외 권한을 받은 경계 상황에서도 자기 자신은 제외 대상이 아니다.
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
    // 공유 문구(`mapTeamError`)가 이 코드의 실제 원인을 말한다.
    expect(host.textContent).toContain(
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
    expect(host.textContent).toContain('알 수 없는 이유로 거절되었습니다.');
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
    // 라우트가 바뀐 계정을 넣어 준다 — 앞 계정의 답은 이제 이 화면의 것이 아니다.
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

/**
 * 목록 머리의 「+」 하나가 초대의 유일한 시작점이다. 패널은 초대를 직접 만들지
 * 않고(팀이 아직 없을 수도 있다) 화면에 그 사실만 알린다.
 */
describe('TeamMembersPanel — 초대 시작', () => {
  it('초대 아이콘은 이름표와 설명을 갖고, 누르면 화면의 준비 절차만 부른다', async () => {
    await render();
    const plus = inviteTrigger();
    expect(plus).not.toBeNull();
    expect(plus?.getAttribute('aria-haspopup')).toBe('dialog');
    // 화면이 초점을 되돌릴 수 있도록 트리거를 그대로 넘겨 받는다.
    expect(inviteTriggerRef.current).toBe(plus);
    // 조작 사각형은 44px 토큰(`w-control`/`h-control`)을 그대로 쓴다.
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

/** 아직 팀이 없는 자리 — 지어낸 팀 id·권한·합류한 팀원을 만들지 않는다. */
describe('TeamMembersPanel — 팀 없음', () => {
  it('내 닉네임만 예정으로 보여 주고 아무 것도 쓰지 않는다', async () => {
    await render({}, 'synthetic-leader', { team: null, invitation: null });
    expect(rosterRows()).toHaveLength(1);
    expect(rosterRows()[0]?.textContent).toContain('synthetic-leader');
    // 지어낸 팀 id·권한 없이 「아직 팀장이 될 사람」이라는 사실만 짧게 붙는다.
    expect(rosterRows()[0]?.textContent).toContain('팀장 예정');
    // 빈 자리를 설명하는 안내 문장을 더 놓지 않는다.
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

/** 대기 중인 초대는 팀원이 아니다 — 목록에는 함께, 인원수에는 따로. */
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
    // 대기 중인 초대만 남는다 — 수락된 초대는 이미 구성원 목록이 말한다.
    expect(pendingRows()).toHaveLength(1);
    expect(pendingRows()[0]?.textContent).toContain('합성 초대 대상');
    expect(pendingRows()[0]?.textContent).toContain('synthetic-one');
    expect(pendingRows()[0]?.textContent).toContain('초대 대기');
    expect(rosterRows()).toHaveLength(3);
    expect(host.textContent).toContain('팀원 3명');
    // 따로 떨어진 「보낸 초대」 카드는 더 이상 없다.
    expect(host.textContent).not.toContain('보낸 초대가 없습니다');
    // 목록은 하나다 — 팀원과 대기 초대가 같은 줄들로 이어진다.
    expect(host.querySelectorAll('ul')).toHaveLength(1);
    expect(listRows()).toHaveLength(4);
    // 순서도 고정이다 — 합류한 사람이 먼저, 기다리는 사람이 뒤에.
    expect(listRows()[3]?.textContent).toContain('초대 대기');
    // 줄이 서로 붙지 않도록 항목 사이에 같은 토큰의 구분선을 긋는다.
    const list = host.querySelector('ul[aria-label="팀 구성원과 초대"]');
    expect(list?.className).toContain('[&>li+li]:border-t');
    expect(list?.className).toContain('[&>li+li]:border-border/50');
  });

  it('이미 합류한 사람의 대기 초대는 같은 목록에 두 번 내지 않는다', async () => {
    // 팀과 보낸 초대는 서로 다른 조회라 잠시 어긍나는 순간이 생긴다.
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
    // 그 사람은 이미 팀원 행으로 한 번만 있다.
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

    // 훅이 실패를 돌려준다 — 초대 레이어는 닫혀 있는 「우리 팀」 화면이다.
    await render({}, 'synthetic-leader', {
      invitation: invitationManagement({
        sentInvitations: [sentInvitation()],
        inviteActionError: '이미 응답한 초대는 취소할 수 없습니다.',
      }),
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.textContent).toContain('초대 취소 실패');
    expect(host.textContent).toContain(
      '이미 응답한 초대는 취소할 수 없습니다.',
    );

    // 다시 시도는 새 조작이 아니라 같은 취소다.
    const retry = Array.from(host.querySelectorAll('button')).find(
      (item) => item.textContent === '다시 시도',
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(onCancelInvitation).toHaveBeenCalledTimes(2);
    expect(onCancelInvitation).toHaveBeenLastCalledWith('inv-1');
    // 목록의 조작은 그대로 살아 있다.
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

/** 신청 전 구성 화면(`compose`)에는 제외라는 조작이 존재하지 않는다. */
describe('TeamMembersPanel — 화면 모드', () => {
  it('compose에서는 서버가 제외 권한을 주더라도 제외를 그리지 않는다', async () => {
    await render({}, 'synthetic-leader', { mode: 'compose' });
    expect(removeButtons()).toHaveLength(0);
    expect(removeMyTeamMember).not.toHaveBeenCalled();
    // 대신 초대 시작은 그대로 있다 — 구성 화면의 목적이 팀을 채우는 일이다.
    expect(inviteTrigger()).not.toBeNull();
  });

  it('manage에서는 같은 팀이 제외를 다시 갖는다', async () => {
    await render({}, 'synthetic-leader', { mode: 'manage' });
    expect(removeButtons()).toHaveLength(2);
  });
});

/**
 * 같은 자리에 남아 있는 컴포넌트가 다른 신원을 맞을 때의 경계.
 *
 * 늦게 도착한 응답을 무시하는 것만으로는 부족하다 — 앞 신원의 확인 레이어·진행
 * 표식·오류가 새 신원의 화면에 그대로 남아 있으면, 다른 사람을 지우려는 확인
 * 창을 새 계정이 물려받는 셈이다.
 */
describe('TeamMembersPanel — 신원 경계', () => {
  it('세션이 바뀌면 앞 계정의 확인 레이어·진행 표식을 그 자리에서 버린다', async () => {
    const first = deferred();
    vi.mocked(removeMyTeamMember).mockReturnValueOnce(first.promise);
    await render();
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    expect(dialog()).not.toBeNull();

    // 팀은 그대로고 계정만 바뀐다.
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

    // 새 신원이 자기 요청을 시작한다.
    await act(async () => removeButtons()[0]?.click());
    await act(async () => dialogButton('팀에서 제외').click());
    expect(removeMyTeamMember).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve());

    expect(onChanged).not.toHaveBeenCalled();
    expect(dialogButton('처리 중…').disabled).toBe(true);
    expect(host.textContent).not.toContain('팀에서 제외 실패');

    // 새 신원의 요청만이 새 신원을 움직인다.
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

    // 권한이 돌아와도 앞 요청의 진행·오류가 되살아나지 않는다.
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
