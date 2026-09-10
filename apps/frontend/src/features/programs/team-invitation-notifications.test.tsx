// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import type { ReceivedTeamInvitation } from './team-invitation-api';
import { TeamInvitationNotifications } from './team-invitation-notifications';
import {
  TEAM_MEMBERSHIP_CHANGED_EVENT,
  type TeamMembershipChangedDetail,
} from './team-membership-events';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  listReceivedInvitations: vi.fn(),
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('./team-invitation-api', () => ({
  listReceivedInvitations: mocks.listReceivedInvitations,
  acceptInvitation: mocks.acceptInvitation,
  declineInvitation: mocks.declineInvitation,
}));

function problem(detail: string, status = 409): ApiError {
  const body: ProblemDetail = {
    type: 'about:blank',
    title: '충돌',
    status,
    detail,
    instance: 'urn:test:team-invitation-accept',
    code: 'TIV_011',
  };
  return new ApiError(body);
}

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

function pendingInvitation(
  overrides: Partial<ReceivedTeamInvitation> = {},
): ReceivedTeamInvitation {
  return {
    id: 'inv-1',
    teamId: 'team-1',
    programId: 'program-1',
    invitedById: 'user-9',
    status: 'PENDING',
    invitedAt: '2026-07-01T00:00:00.000Z',
    respondedAt: null,
    teamName: '오픈소스팀',
    programName: '캡스톤 2026',
    invitedByDisplayName: '팀장',
    memberCount: 2,
    teamMaxSize: 4,
    ...overrides,
  };
}

async function settleUntil(assert: () => void): Promise<void> {
  await vi.waitFor(assert);
}

function findButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (!button) {
    throw new Error(`「${label}」 버튼을 찾지 못했다.`);
  }
  return button;
}

function findProgramLink(name: string): HTMLAnchorElement {
  const link = [...document.querySelectorAll('a')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!link) throw new Error(`「${name}」 프로그램 링크를 찾지 못했다.`);
  return link;
}

function recordMembershipEvents(): {
  readonly programIds: string[];
  readonly stop: () => void;
} {
  const programIds: string[] = [];
  const listener = (event: Event) => {
    programIds.push(
      (event as CustomEvent<TeamMembershipChangedDetail>).detail.programId,
    );
  };
  window.addEventListener(TEAM_MEMBERSHIP_CHANGED_EVENT, listener);
  return {
    programIds,
    stop: () =>
      window.removeEventListener(TEAM_MEMBERSHIP_CHANGED_EVENT, listener),
  };
}

function findRetryButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes('다시 시도') === true,
  );
  if (!button) throw new Error('다시 시도 버튼을 찾지 못했다.');
  return button;
}

describe('TeamInvitationNotifications', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.listReceivedInvitations.mockReset().mockResolvedValue([]);
    mocks.acceptInvitation.mockReset().mockResolvedValue({
      teamId: 'team-1',
      programId: 'program-1',
    });
    mocks.declineInvitation.mockReset().mockResolvedValue(undefined);
    mocks.push.mockReset();
    mocks.refresh.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('받은 초대의 팀·프로그램 요약과 대기 건수를 보여 준다', async () => {
    mocks.listReceivedInvitations.mockResolvedValue([
      pendingInvitation(),
      pendingInvitation({
        id: 'inv-closed',
        status: 'DECLINED',
        teamName: '닫힌 팀',
      }),
    ]);

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]')
          ?.textContent,
      ).toBe('1');
    });

    await act(async () => {
      findButton('팀 초대 알림').click();
    });

    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('캡스톤 2026');
    expect(text).toContain('팀장님이 초대했습니다');
    expect(text).toContain('2/4명');
    expect(text).not.toContain('닫힌 팀');
    expect(findButton('팀 초대 알림').getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('조회가 실패하면 오류와 다시 시도를 보여 주고 재시도로 목록을 복구한다', async () => {
    mocks.listReceivedInvitations
      .mockRejectedValueOnce(problem('받은 초대를 읽지 못했습니다.', 500))
      .mockRejectedValueOnce(problem('받은 초대를 읽지 못했습니다.', 500))
      .mockResolvedValue([pendingInvitation()]);

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain(
        '받은 초대를 읽지 못했습니다.',
      );
    });

    await act(async () => {
      findRetryButton().click();
    });

    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });
  });

  it('대기 중인 초대가 없으면 빈 상태를 보여 준다', async () => {
    mocks.listReceivedInvitations.mockResolvedValue([]);

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain(
        '새로운 팀 초대가 없습니다.',
      );
    });
  });

  it('닫힌 알림에서도 포커스 갱신으로 새 초대 건수를 올린다', async () => {
    mocks.listReceivedInvitations.mockResolvedValueOnce([]);
    mocks.listReceivedInvitations.mockResolvedValue([pendingInvitation()]);

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(mocks.listReceivedInvitations).toHaveBeenCalledTimes(1);
    });
    expect(
      document.querySelector('[data-slot="team-invitation-count"]'),
    ).toBeNull();

    await act(async () => {
      findButton('팀 초대 알림').focus();
    });

    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]')
          ?.textContent,
      ).toBe('1');
    });
    expect(findButton('팀 초대 알림').getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('갱신 실패는 기존 목록을 남기고 오류와 다시 시도를 보여 준다', async () => {
    mocks.listReceivedInvitations.mockResolvedValueOnce([pendingInvitation()]);
    mocks.listReceivedInvitations.mockRejectedValue(
      problem('목록을 다시 읽지 못했습니다.', 500),
    );

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]')
          ?.textContent,
      ).toBe('1');
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain(
        '목록을 다시 읽지 못했습니다.',
      );
    });
    expect(document.body.textContent ?? '').toContain('오픈소스팀');
    expect(findRetryButton()).toBeTruthy();
  });

  it('수락하면 응답의 programId로 「우리 팀」 화면을 연다', async () => {
    mocks.listReceivedInvitations.mockResolvedValue([
      pendingInvitation({ programId: 'stale-program', teamId: 'stale-team' }),
    ]);
    mocks.acceptInvitation.mockResolvedValue({
      teamId: 'team:accepted',
      programId: 'prog:1',
    });

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]'),
      ).not.toBeNull();
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });

    await act(async () => {
      findButton('오픈소스팀 팀 초대 수락').click();
    });

    await settleUntil(() => {
      expect(mocks.acceptInvitation).toHaveBeenCalledWith('inv-1');
    });
    expect(mocks.push).toHaveBeenCalledWith('/programs/prog%3A1/my-team');
    expect(mocks.push).not.toHaveBeenCalledWith(
      expect.stringContaining('/apply'),
    );
    expect(mocks.push).not.toHaveBeenCalledWith(
      expect.stringContaining('teamId='),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    await settleUntil(() => {
      expect(document.body.textContent ?? '').not.toContain('오픈소스팀');
    });
  });

  it('같은 URL에 있는 「우리 팀」 화면에게 수락한 programId를 알린다', async () => {
    mocks.listReceivedInvitations.mockResolvedValue([pendingInvitation()]);
    mocks.acceptInvitation.mockResolvedValue({
      teamId: 'team-1',
      programId: 'program-1',
    });
    const events = recordMembershipEvents();

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]'),
      ).not.toBeNull();
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });

    await act(async () => {
      findButton('오픈소스팀 팀 초대 수락').click();
    });

    await settleUntil(() => {
      expect(mocks.push).toHaveBeenCalledWith('/programs/program-1/my-team');
    });
    expect(events.programIds).toEqual(['program-1']);
    expect(mocks.refresh).toHaveBeenCalled();
    events.stop();
  });

  it('대기 중인 초대의 프로그램명은 개요 화면만 연다', async () => {
    mocks.listReceivedInvitations.mockResolvedValue([
      pendingInvitation({ programId: 'prog:1', programName: '캡스톤 2026' }),
    ]);

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]'),
      ).not.toBeNull();
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('캡스톤 2026');
    });

    const link = findProgramLink('캡스톤 2026');
    expect(link.getAttribute('href')).toBe('/programs/prog%3A1');
    const hrefs = [...document.querySelectorAll('a')].map((anchor) =>
      anchor.getAttribute('href'),
    );
    expect(hrefs).not.toContain('/programs/prog%3A1/my-team');
    expect(hrefs.some((href) => href?.includes('/apply') === true)).toBe(false);
  });

  it('거절하면 항목을 지우고 이동도 알림도 없다', async () => {
    mocks.listReceivedInvitations.mockResolvedValue([pendingInvitation()]);
    const events = recordMembershipEvents();

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]'),
      ).not.toBeNull();
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });

    await act(async () => {
      findButton('오픈소스팀 팀 초대 거절').click();
    });

    await settleUntil(() => {
      expect(mocks.declineInvitation).toHaveBeenCalledWith('inv-1');
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(events.programIds).toEqual([]);
    await settleUntil(() => {
      expect(document.body.textContent ?? '').not.toContain('오픈소스팀');
    });
    events.stop();
  });

  it('수락 실패는 그 항목에만 오류를 남기고 알림을 보내지 않는다', async () => {
    mocks.listReceivedInvitations.mockResolvedValue([pendingInvitation()]);
    mocks.acceptInvitation.mockRejectedValue(
      problem('이미 처리된 초대입니다.'),
    );
    const events = recordMembershipEvents();

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]'),
      ).not.toBeNull();
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });

    await act(async () => {
      findButton('오픈소스팀 팀 초대 수락').click();
    });

    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain(
        '이미 처리된 초대입니다.',
      );
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(events.programIds).toEqual([]);
    expect(document.body.textContent ?? '').toContain('오픈소스팀');
    events.stop();
  });

  it('수락 응답이 이전 계정의 것이면 이동도 알림도 하지 않는다', async () => {
    const accept = deferred<{ teamId: string; programId: string }>();
    mocks.listReceivedInvitations.mockResolvedValue([pendingInvitation()]);
    mocks.acceptInvitation.mockReturnValue(accept.promise);
    const events = recordMembershipEvents();

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]'),
      ).not.toBeNull();
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });
    await act(async () => {
      findButton('오픈소스팀 팀 초대 수락').click();
    });

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-b" />);
    });
    await act(async () => {
      accept.resolve({ teamId: 'team-1', programId: 'program-1' });
      await Promise.resolve();
    });

    expect(events.programIds).toEqual([]);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    events.stop();
  });

  it('처리 중인 초대를 다시 눌러도 요청을 한 번만 보낸다', async () => {
    const accept = deferred<{ teamId: string; programId: string }>();
    mocks.listReceivedInvitations.mockResolvedValue([pendingInvitation()]);
    mocks.acceptInvitation.mockReturnValue(accept.promise);

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]'),
      ).not.toBeNull();
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });

    const acceptButton = findButton('오픈소스팀 팀 초대 수락');
    await act(async () => {
      acceptButton.click();
      acceptButton.click();
    });

    expect(mocks.acceptInvitation).toHaveBeenCalledTimes(1);
    await act(async () => {
      accept.resolve({ teamId: 'team-1', programId: 'program-1' });
    });
  });

  it('수락 뒤에 도착한 이전 목록 조회는 지운 초대를 되살리지 않는다', async () => {
    const list = deferred<readonly ReceivedTeamInvitation[]>();
    mocks.listReceivedInvitations.mockResolvedValueOnce([pendingInvitation()]);
    mocks.listReceivedInvitations.mockReturnValue(list.promise);
    mocks.acceptInvitation.mockResolvedValue({
      teamId: 'team-1',
      programId: 'program-1',
    });

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]')
          ?.textContent,
      ).toBe('1');
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('오픈소스팀');
    });

    await act(async () => {
      findButton('오픈소스팀 팀 초대 수락').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').not.toContain('오픈소스팀');
    });

    await act(async () => {
      list.resolve([pendingInvitation()]);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent ?? '').not.toContain('오픈소스팀');
    expect(
      document.querySelector('[data-slot="team-invitation-count"]'),
    ).toBeNull();
  });

  it('계정이 바뀌면 이전 조회 응답을 목록에 넣지 않는다', async () => {
    const first = deferred<readonly ReceivedTeamInvitation[]>();
    mocks.listReceivedInvitations.mockReturnValueOnce(first.promise);
    mocks.listReceivedInvitations.mockResolvedValue([
      pendingInvitation({
        id: 'inv-b',
        teamName: '새 계정 팀',
        programName: '새 프로그램',
      }),
    ]);

    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-a" />);
    });
    await act(async () => {
      root.render(<TeamInvitationNotifications identityKey="student-b" />);
    });
    await act(async () => {
      first.resolve([pendingInvitation({ teamName: '이전 계정 팀' })]);
    });

    await settleUntil(() => {
      expect(
        document.querySelector('[data-slot="team-invitation-count"]')
          ?.textContent,
      ).toBe('1');
    });
    await act(async () => {
      findButton('팀 초대 알림').click();
    });
    await settleUntil(() => {
      expect(document.body.textContent ?? '').toContain('새 계정 팀');
    });
    expect(document.body.textContent ?? '').not.toContain('이전 계정 팀');
  });
});
