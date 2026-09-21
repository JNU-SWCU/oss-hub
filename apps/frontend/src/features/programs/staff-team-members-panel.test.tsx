import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProgramTeamMember } from './types';

// @vitest-environment happy-dom

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const {
  removeStaffTeamMemberMock,
  transferStaffTeamLeaderMock,
  useTeamInvitationManagementMock,
} = vi.hoisted(() => ({
  removeStaffTeamMemberMock: vi.fn(),
  transferStaffTeamLeaderMock: vi.fn(),
  useTeamInvitationManagementMock: vi.fn(),
}));

vi.mock('./staff-team-members-api', () => ({
  removeStaffTeamMember: removeStaffTeamMemberMock,
  transferStaffTeamLeader: transferStaffTeamLeaderMock,
}));

vi.mock('./use-team-invitation-management', () => ({
  useTeamInvitationManagement: useTeamInvitationManagementMock,
}));

const { StaffTeamMembersPanel } = await import('./staff-team-members-panel');

const LEADER: StaffProgramTeamMember = {
  userId: 'user-leader',
  name: '합성 팀장',
  nickname: 'synthetic-leader',
  isLeader: true,
};
const MEMBER: StaffProgramTeamMember = {
  userId: 'user-member',
  name: '합성 팀원',
  nickname: 'synthetic-member',
  isLeader: false,
};

const IDLE_INVITATION = {
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
  onRetrySent: vi.fn(),
  onInviteQueryChange: vi.fn(),
  onSearch: vi.fn(),
  onInvite: vi.fn(),
  onCancelInvitation: vi.fn(),
  reloadSent: vi.fn(async () => {}),
};

let container: HTMLDivElement;
let root: Root;
let onChanged: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useTeamInvitationManagementMock.mockReturnValue(IDLE_INVITATION);
  removeStaffTeamMemberMock.mockResolvedValue(undefined);
  transferStaffTeamLeaderMock.mockResolvedValue(undefined);
  onChanged = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  members: readonly StaffProgramTeamMember[] = [LEADER, MEMBER],
): Promise<void> {
  await act(async () => {
    root.render(
      <StaffTeamMembersPanel
        programId="program-1"
        teamId="team-1"
        teamName="합성 팀"
        memberCount={members.length}
        members={members}
        sessionKey="synthetic-staff"
        onChanged={onChanged}
      />,
    );
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found as HTMLButtonElement;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => button.click());
}

/** 확인 창의 실행 버튼 — 문구로 찾는다. */
async function confirm(text: string): Promise<void> {
  const found = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`confirm button not found: ${text}`);
  await act(async () => (found as HTMLButtonElement).click());
}

describe('StaffTeamMembersPanel', () => {
  it('명단과 팀원별 조작 입구를 그린다', async () => {
    await render();

    expect(container.textContent).toContain('합성 팀장');
    expect(container.textContent).toContain('합성 팀원');
    expect(() => buttonByLabel('합성 팀원 팀에서 제외')).not.toThrow();
    expect(() => buttonByLabel('합성 팀원 팀장 변경')).not.toThrow();
  });

  /**
   * 누르자마자 지우지 않는다 — 사람을 팀에서 빼는 것은 되돌리기 어렵고,
   * 명단에서 옆줄을 잘못 누르기 쉽다.
   */
  it('제외는 확인을 거쳐야 요청이 나간다', async () => {
    await render();

    await click(buttonByLabel('합성 팀원 팀에서 제외'));
    expect(removeStaffTeamMemberMock).not.toHaveBeenCalled();

    await confirm('팀에서 제외');
    expect(removeStaffTeamMemberMock).toHaveBeenCalledWith(
      'program-1',
      'team-1',
      'user-member',
    );
  });

  it('팀장 변경도 확인을 거쳐야 요청이 나간다', async () => {
    await render();

    await click(buttonByLabel('합성 팀원 팀장 변경'));
    expect(transferStaffTeamLeaderMock).not.toHaveBeenCalled();

    await confirm('팀장 변경');
    expect(transferStaffTeamLeaderMock).toHaveBeenCalledWith(
      'program-1',
      'team-1',
      'user-member',
    );
  });

  /**
   * 화면이 스스로 명단을 고치지 않는다 — 마지막 팀원 규칙이나 승계처럼 서버만
   * 아는 결과가 있어서, 바뀐 뒤의 사실은 다시 읽어서 받는다.
   */
  it('성공하면 화면에 다시 읽으라고 알린다', async () => {
    await render();

    await click(buttonByLabel('합성 팀원 팀에서 제외'));
    await confirm('팀에서 제외');

    expect(onChanged).toHaveBeenCalled();
  });

  /**
   * 실패해도 다시 읽는다. 요청이 오류로 끝난 것은 서버가 적용하지 않았다는 증거가
   * 아니다 — 응답이 오기 전에 끊길 수 있다. 판정 재조회가 같은 이유로 응답이 아니라
   * 다시 읽은 값을 화면 상태로 쓴다.
   */
  it('실패해도 알리고 다시 읽는다 — 오류가 미적용을 뜻하지 않는다', async () => {
    removeStaffTeamMemberMock.mockRejectedValue(new Error('boom'));
    await render();

    await click(buttonByLabel('합성 팀원 팀에서 제외'));
    await confirm('팀에서 제외');

    expect(onChanged).toHaveBeenCalled();
    // 화면이 스스로 명단을 고치지는 않는다.
    expect(container.textContent).toContain('합성 팀원');
    expect(document.body.textContent).toContain('팀에서 제외 실패');
  });
});
