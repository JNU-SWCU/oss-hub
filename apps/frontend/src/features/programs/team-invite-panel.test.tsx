// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamInvitePanel } from './team-invite-panel';
import type {
  InvitationCandidate,
  SentTeamInvitation,
} from './team-invitation-api';
import type { TeamInvitationManagement } from './use-team-invitation-management';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const candidates: InvitationCandidate[] = [
  {
    id: 'user-1',
    nickname: 'synthetic-one',
    name: '합성 후보',
    avatarUrl: null,
  },
  { id: 'user-2', nickname: 'synthetic-two', name: null, avatarUrl: null },
];

/** 서버가 확인해 준 「보낸 초대」 하나 — 화면이 지어내는 값이 아니다. */
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
    invitee: candidates[0]!,
    ...overrides,
  };
}

const onInviteQueryChange = vi.fn();
const onSearch = vi.fn();
const onInvite = vi.fn();
const onCancelInvitation = vi.fn();
const onRetrySent = vi.fn();
const reloadSent = vi.fn(async () => undefined);
const onClose = vi.fn();

function management(
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
    reloadSent,
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;
const returnFocusRef: { current: HTMLButtonElement | null } = { current: null };

beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = '팀원 초대';
  document.body.append(trigger);
  returnFocusRef.current = trigger;
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  trigger.remove();
});

async function render(
  overrides: Partial<TeamInvitationManagement> = {},
  open = true,
) {
  await act(async () =>
    root.render(
      <TeamInvitePanel
        invitation={management(overrides)}
        open={open}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
      />,
    ),
  );
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function input(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('#invite-search');
  if (!found) throw new Error('검색 입력을 찾지 못했다.');
  return found;
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === text,
  );
}

/** 실제 키 입력처럼 cancelable keydown을 흘려보내고, 핸들러가 막았는지 함께 돌려준다. */
function pressKey(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('TeamInvitePanel — 열림 상태', () => {
  it('닫혀 있으면 아무것도 그리지 않고 아무 요청도 만들지 않는다', async () => {
    await render({}, false);
    expect(dialog()).toBeNull();
    expect(document.querySelector('#invite-search')).toBeNull();
    expect(onSearch).not.toHaveBeenCalled();
    expect(onInvite).not.toHaveBeenCalled();
    expect(reloadSent).not.toHaveBeenCalled();
    expect(onRetrySent).not.toHaveBeenCalled();
  });

  it('열려도 스스로 검색·초대를 시작하지 않는다', async () => {
    await render({ inviteQuery: 'oc' });
    expect(dialog()).not.toBeNull();
    expect(onSearch).not.toHaveBeenCalled();
    expect(onInvite).not.toHaveBeenCalled();
    expect(reloadSent).not.toHaveBeenCalled();
  });

  it('모달로 열리고 제목과 검색 입력을 갖는다', async () => {
    await render();
    const layer = dialog();
    expect(layer).not.toBeNull();
    // 제목이 레이어 이름이다 — 읽어 주는 도구가 어디에 들어왔는지 말할 수 있어야 한다.
    const titleId = layer?.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId ?? '')?.textContent).toBe(
      '팀원 초대',
    );
    expect(input().getAttribute('role')).toBe('combobox');
  });

  it('중복 조작을 없앤다 — 검색 버튼과 보낸 초대 목록은 이 레이어에 없다', async () => {
    await render({ inviteQuery: 'oc', inviteCandidates: candidates });
    expect(buttonWithText('검색')).toBeUndefined();
    expect(buttonWithText('검색 중…')).toBeUndefined();
    expect(document.body.textContent).not.toContain('보낸 초대');
    expect(document.body.textContent).not.toContain('보낸 초대가 없습니다.');
  });

  it('검색 후보를 닉네임과 표시 이름으로 식별한다', async () => {
    await render({ inviteQuery: 'oc', inviteCandidates: candidates });
    const text = document.body.textContent ?? '';
    expect(text).toContain('합성 후보');
    expect(text).toContain('synthetic-one');
    expect(text).toContain('synthetic-two');
    expect(text).not.toContain('학번');
    expect(text.match(/synthetic-two/g)).toHaveLength(1);
  });

  it('표시 이름이 닉네임과 같으면 한 번만 표시한다', async () => {
    await render({
      inviteQuery: 'oc',
      inviteCandidates: [{ ...candidates[0]!, name: 'synthetic-one' }],
    });
    expect(document.body.textContent?.match(/synthetic-one/g)).toHaveLength(1);
  });

  it('검색과 요청 오류를 유지한다', async () => {
    await render({
      searchError: '검색을 다시 시도해 주세요.',
      inviteActionError: '팀 최대 인원을 초과할 수 없습니다.',
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('검색을 다시 시도해 주세요.');
    expect(text).toContain('팀 최대 인원을 초과할 수 없습니다.');
  });
});

describe('TeamInvitePanel — 초대 보내기', () => {
  it('후보의 초대 버튼이 실제 초대를 부른다', async () => {
    await render({ inviteQuery: 'oc', inviteCandidates: candidates });
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '[role="option"] button',
    );
    expect(buttons).toHaveLength(2);
    await act(async () => buttons[1]?.click());
    expect(onInvite).toHaveBeenCalledExactlyOnceWith(candidates[1]);
  });

  it('보내는 중에는 그 후보만 잠기고 진행을 밝힌다', async () => {
    await render({
      inviteQuery: 'oc',
      inviteCandidates: candidates,
      invitingUserId: 'user-1',
    });
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"] button'),
    );
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[0]?.textContent).toBe('초대 중…');
    expect(buttons[1]?.disabled).toBe(false);
  });

  it('입력은 화면 상태만 바꾼다 — 그 자체로는 아무것도 보내지 않는다', async () => {
    await render();
    const field = input();
    await act(async () => {
      // React가 값 변화를 알아보려면 네이티브 setter를 거쳐야 한다.
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setValue?.call(field, 'oct');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onInviteQueryChange).toHaveBeenCalledExactlyOnceWith('oct');
    expect(onInvite).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe('TeamInvitePanel — 중복 초대', () => {
  it('이미 대기 중인 후보에게는 초대 버튼 대신 「초대 대기」만 보인다', async () => {
    await render({
      inviteQuery: 'oc',
      inviteCandidates: candidates,
      sentInvitations: [sentInvitation()],
    });
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options).toHaveLength(2);
    // 대기 중인 후보 행에는 누를 것이 없다 — 눌러 봐야 서버가 409로 거절한다.
    expect(options[0]?.querySelector('button')).toBeNull();
    expect(options[0]?.textContent).toContain('초대 대기');
    expect(options[0]?.querySelector('[role="status"]')?.textContent).toBe(
      '초대 대기',
    );
    // 아직 초대하지 않은 후보의 조작은 그대로다.
    expect(options[1]?.querySelector('button')?.textContent).toBe('초대');
    expect(options[1]?.querySelector('button')?.disabled).toBe(false);
  });

  it('수락·거절된 초대는 다시 초대할 수 있다 — 대기만 조작을 거둔다', async () => {
    await render({
      inviteQuery: 'oc',
      inviteCandidates: candidates,
      sentInvitations: [
        sentInvitation({
          status: 'DECLINED',
          respondedAt: '2026-07-02T00:00:00Z',
        }),
      ],
    });
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options[0]?.textContent).not.toContain('초대 대기');
    const invite = options[0]?.querySelector('button');
    expect(invite?.textContent).toBe('초대');
    await act(async () => invite?.click());
    expect(onInvite).toHaveBeenCalledExactlyOnceWith(candidates[0]);
  });

  it('서버가 확인한 뒤에야 그 후보가 대기로 바뀌고 두 번째 초대가 사라진다', async () => {
    await render({ inviteQuery: 'oc', inviteCandidates: candidates });
    const before = document.querySelectorAll<HTMLButtonElement>(
      '[role="option"] button',
    );
    expect(before).toHaveLength(2);
    await act(async () => before[0]?.click());
    expect(onInvite).toHaveBeenCalledExactlyOnceWith(candidates[0]);

    // 보낸 초대가 실제로 다시 읽힌 뒤에만 화면이 바뀐다.
    await render({
      inviteQuery: 'oc',
      inviteCandidates: candidates,
      sentInvitations: [sentInvitation()],
    });
    const after = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(after[0]?.querySelector('button')).toBeNull();
    expect(after[0]?.textContent).toContain('초대 대기');
    // 같은 사람에게 초대를 한 번 더 보낼 길이 없다.
    expect(onInvite).toHaveBeenCalledOnce();
  });

  it('진행 중 표시는 그대로다 — 아직 확인되지 않은 초대를 대기로 지어내지 않는다', async () => {
    await render({
      inviteQuery: 'oc',
      inviteCandidates: candidates,
      invitingUserId: 'user-1',
    });
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options[0]?.textContent).not.toContain('초대 대기');
    expect(options[0]?.querySelector('button')?.textContent).toBe('초대 중…');
  });
});

describe('TeamInvitePanel — 닫기와 초점', () => {
  it('닫기 버튼은 화면에 닫기를 알린다', async () => {
    await render();
    const close = buttonWithText('닫기');
    expect(close).toBeDefined();
    await act(async () => close?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('목록이 열려 있는 Escape는 목록만 닫는다', async () => {
    await render({ inviteQuery: 'oc', inviteCandidates: candidates });
    expect(input().getAttribute('aria-expanded')).toBe('true');

    pressKey(input(), 'Escape');

    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(dialog()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('목록이 닫혀 있으면 Escape가 레이어를 닫는다', async () => {
    await render();
    pressKey(input(), 'Escape');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('초대를 보내는 동안에는 Escape와 닫기를 막는다', async () => {
    await render({
      inviteQuery: 'oc',
      inviteCandidates: candidates,
      invitingUserId: 'user-1',
    });
    expect(buttonWithText('닫기')?.disabled).toBe(true);
    pressKey(document.body, 'Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('닫히면 초점이 초대를 연 버튼으로 돌아간다', async () => {
    await render();
    expect(document.activeElement).not.toBe(trigger);
    await render({}, false);
    expect(document.activeElement).toBe(trigger);
  });
});
