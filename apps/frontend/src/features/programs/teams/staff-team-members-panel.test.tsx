import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProgramTeamMember } from './dto';
import type { TeamActivity } from './team-activity-dto';
import type { TeamInvitationManagement } from './use-team-invitation-management';

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
  moreCandidates: false,
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
} satisfies TeamInvitationManagement;

const PENDING_INVITATION = {
  id: 'invite-1',
  invitee: { id: 'user-invitee', name: '합성 초대자', nickname: 'invited' },
};

const point = (date: string, commitCount: number, pullRequestCount = 0) => ({
  date,
  commitCount,
  pullRequestCount,
  issueCount: 0,
});

const ACTIVITY: TeamActivity = {
  teamId: 'team-1',
  repository: { id: 'repo-1', url: 'https://github.com/synthetic/team' },
  status: 'COLLECTED',
  lastSuccessAt: '2026-11-19T15:00:00Z',
  window: { from: '2026-11-01', to: '2026-11-30', timeZone: 'Asia/Seoul' },
  canEditRepositoryUrl: false,
  members: [
    {
      userId: LEADER.userId,
      githubLogin: LEADER.nickname,
      totals: { commitCount: 902, pullRequestCount: 0, issueCount: 0 },
      points: [
        point('2026-11-06', 100),
        point('2026-11-07', 17),
        point('2026-11-20', 25),
        point('2026-11-21', 760),
      ],
    },
    {
      userId: MEMBER.userId,
      githubLogin: MEMBER.nickname,
      totals: { commitCount: 18, pullRequestCount: 1, issueCount: 0 },
      points: [point('2026-11-06', 18), point('2026-11-20', 0, 1)],
    },
  ],
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
  vi.restoreAllMocks();
});

async function render(
  members: readonly StaffProgramTeamMember[] = [LEADER, MEMBER],
  activity?: TeamActivity,
): Promise<void> {
  await act(async () => {
    root.render(
      <StaffTeamMembersPanel
        programId="program-1"
        teamId="team-1"
        memberCount={members.length}
        members={members}
        activity={activity}
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
  return found;
}

async function press(node: Element, key: string): Promise<void> {
  act(() => {
    node.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

async function openMenu(displayName: string, key = 'ArrowDown') {
  const trigger = buttonByLabel(`${displayName} 작업`);
  act(() => trigger.focus());
  await press(trigger, key);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  return trigger;
}

async function choose(text: string): Promise<void> {
  const item = menuItems().find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!item) throw new Error(`menu item not found: ${text}`);
  await act(async () => item.focus());
  await press(item, 'Enter');
}

function dialogButton(text: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  const found = [...(dialog?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!found) throw new Error(`confirm button not found: ${text}`);
  return found;
}

async function confirm(text: string): Promise<void> {
  await act(async () => dialogButton(text).click());
}

describe('StaffTeamMembersPanel', () => {
  it('팀장을 먼저 두고 이미 합류한 사람의 초대를 제외한 단일 명단을 그린다', async () => {
    useTeamInvitationManagementMock.mockReturnValue({
      ...IDLE_INVITATION,
      sentInvitations: [
        PENDING_INVITATION,
        {
          id: 'invite-accepted',
          invitee: {
            id: MEMBER.userId,
            name: MEMBER.name,
            nickname: MEMBER.nickname,
          },
        },
      ],
    });
    await render([MEMBER, LEADER]);

    expect(container.querySelector('[role="region"] h2')?.textContent).toBe(
      '팀원',
    );
    expect(container.textContent).toContain('2명');
    const rows = container.querySelectorAll(
      'ul[aria-label="팀 구성원과 초대"] > li',
    );
    const actions = Array.from(rows, (row) =>
      row.querySelector('button')?.getAttribute('aria-label'),
    );
    expect(actions).toEqual([
      '합성 팀장 작업',
      '합성 팀원 작업',
      '합성 초대자 작업',
    ]);
    expect(rows[2].textContent).toContain('초대 대기');
    expect(menuItems()).toHaveLength(0);
  });

  it('키보드로 메뉴를 열고 항목을 이동하며 Escape로 행 버튼에 돌아간다', async () => {
    await render();
    const trigger = await openMenu('합성 팀원');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(menuItems().map((item) => item.textContent)).toEqual([
      '팀장 변경',
      '팀에서 제외',
    ]);
    await expect.poll(() => document.activeElement).toBe(menuItems()[0]);

    await press(menuItems()[0], 'ArrowDown');
    const second = menuItems()[1];
    await expect.poll(() => document.activeElement).toBe(second);
    await press(second, 'Escape');
    expect(menuItems()).toHaveLength(0);
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  it('팀장 행에서는 기존대로 제외만 제공한다', async () => {
    await render();
    await openMenu('합성 팀장', 'Enter');
    expect(menuItems().map((item) => item.textContent)).toEqual([
      '팀에서 제외',
    ]);
  });

  it('초대 행에서는 초대 취소만 제공하고 기존 취소 경로를 사용한다', async () => {
    useTeamInvitationManagementMock.mockReturnValue({
      ...IDLE_INVITATION,
      sentInvitations: [PENDING_INVITATION],
    });
    await render();

    await openMenu('합성 초대자');
    expect(menuItems().map((item) => item.textContent)).toEqual(['초대 취소']);
    await choose('초대 취소');
    expect(IDLE_INVITATION.onCancelInvitation).toHaveBeenCalledOnce();
    expect(IDLE_INVITATION.onCancelInvitation).toHaveBeenCalledWith('invite-1');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe('팀원 초대');

    useTeamInvitationManagementMock.mockReturnValue({
      ...IDLE_INVITATION,
      sentInvitations: [PENDING_INVITATION],
      cancelingInvitationId: 'invite-1',
    });
    await render();
    expect(buttonByLabel('합성 초대자 작업').disabled).toBe(true);
  });

  it('서울 날짜 기준 오늘을 포함한 14일의 실제 커밋만 합해 양수일 때만 표시한다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-19T15:00:00Z'));
    await render([LEADER, MEMBER], ACTIVITY);

    const leaderRow = buttonByLabel('합성 팀장 작업').closest('li');
    const memberRow = buttonByLabel('합성 팀원 작업').closest('li');
    expect(leaderRow?.textContent).toContain('최근 2주 커밋 42');
    expect(memberRow?.textContent).not.toContain('커밋');
    expect(container.textContent).not.toContain('이 기간 기여 없음');

    await render([LEADER, MEMBER], { ...ACTIVITY, status: 'ERROR' });
    expect(container.textContent).not.toContain('최근 2주 커밋');
  });

  it('확인을 취소하면 요청하지 않고 메뉴를 연 행 버튼에 초점을 돌린다', async () => {
    await render();
    const trigger = await openMenu('합성 팀원');
    await choose('팀에서 제외');
    expect(menuItems()).toHaveLength(0);
    await expect.poll(() => document.activeElement).toBe(dialogButton('취소'));
    await confirm('취소');

    expect(removeStaffTeamMemberMock).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  it('제외는 확인을 거쳐야 요청이 나간다', async () => {
    await render();

    await openMenu('합성 팀원');
    await choose('팀에서 제외');
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

    const trigger = await openMenu('합성 팀원');
    await choose('팀장 변경');
    expect(transferStaffTeamLeaderMock).not.toHaveBeenCalled();

    await confirm('팀장 변경');
    expect(transferStaffTeamLeaderMock).toHaveBeenCalledWith(
      'program-1',
      'team-1',
      'user-member',
    );
    await expect.poll(() => document.activeElement).toBe(trigger);
  });

  it('성공하면 화면에 다시 읽으라고 알린다', async () => {
    await render();

    await openMenu('합성 팀원');
    await choose('팀에서 제외');
    await confirm('팀에서 제외');

    expect(onChanged).toHaveBeenCalled();
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe('팀원 초대');
  });

  it('실패해도 알리고 다시 읽는다 — 오류가 미적용을 뜻하지 않는다', async () => {
    removeStaffTeamMemberMock.mockRejectedValue(new Error('boom'));
    await render();

    await openMenu('합성 팀원');
    await choose('팀에서 제외');
    await confirm('팀에서 제외');

    expect(onChanged).toHaveBeenCalled();

    expect(container.textContent).toContain('합성 팀원');
    expect(document.body.textContent).toContain('팀에서 제외 실패');
  });
});
