// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramTeam } from './api';
import type { InvitationCandidate } from './team-invitation-api';
import type { ProgramDetail } from './types';
import { ProgramTeamsPage } from './program-teams-page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  getProgramDetail: vi.fn(),
  listApplicationTemplates: vi.fn(),
  getMyTeam: vi.fn(),
  listReceivedInvitations: vi.fn(),
  listSentInvitations: vi.fn(),
  searchInvitationCandidates: vi.fn(),
  apiClient: vi.fn(),
}));

vi.mock('./api', () => ({
  getProgramDetail: mocks.getProgramDetail,
  listApplicationTemplates: mocks.listApplicationTemplates,
  getMyTeam: mocks.getMyTeam,
  createTeam: vi.fn(),
  joinTeam: vi.fn(),
}));

vi.mock('./team-invitation-api', () => ({
  listReceivedInvitations: mocks.listReceivedInvitations,
  listSentInvitations: mocks.listSentInvitations,
  searchInvitationCandidates: mocks.searchInvitationCandidates,
  createInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  declineInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    apiClient: mocks.apiClient,
  };
});

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 팀 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  description: '설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};

const team: ProgramTeam = {
  id: 'team-1',
  name: '오픈소스팀',
  memberCount: 1,
  minMembers: 1,
  maxMembers: 4,
  locked: false,
  isLeader: true,
  members: [{ userId: 'u1', nickname: 'leader', name: '팀장', isLeader: true }],
};

function candidate(id: string, nickname: string): InvitationCandidate {
  return { id, nickname, name: null, avatarUrl: null };
}

/** 나중에 원하는 시점에 결착시킬 수 있는, 아직 처리되지 않은 요청 응답. */
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

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  mocks.getProgramDetail.mockReset().mockResolvedValue(program);
  mocks.listApplicationTemplates.mockReset().mockResolvedValue([]);
  mocks.getMyTeam.mockReset().mockResolvedValue(team);
  mocks.listReceivedInvitations.mockReset().mockResolvedValue([]);
  mocks.listSentInvitations.mockReset().mockResolvedValue([]);
  mocks.searchInvitationCandidates.mockReset();
  mocks.apiClient.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function waitForCondition(
  predicate: () => boolean,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error(`${label} 조건을 만족하지 못했다.`);
}

function getSearchInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('#invite-search');
  if (!input) throw new Error('검색 입력을 찾지 못했다.');
  return input;
}

function getSearchForm(): HTMLFormElement {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement))
    throw new Error('검색 폼을 찾지 못했다.');
  return form;
}

/** React가 듣는 것은 네이티브 input 이벤트라 setter를 직접 호출해 값을 넣는다. */
function typeQuery(value: string): void {
  const input = getSearchInput();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Enter·버튼이 아니라 폼 submit 자체를 흘려보내 즉시(디바운스 없이) 검색을 돈다. */
async function submitSearch(): Promise<void> {
  const form = getSearchForm();
  await act(async () => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
}

async function renderReady(): Promise<void> {
  act(() => {
    root.render(<ProgramTeamsPage programId="program-1" />);
  });
  await waitForCondition(
    () => container.querySelector('#invite-search') !== null,
    '팀 초대 검색 입력 렌더링',
  );
}

async function renderLocked(): Promise<void> {
  mocks.getMyTeam.mockResolvedValue({ ...team, locked: true });
  act(() => {
    root.render(<ProgramTeamsPage programId="program-1" />);
  });
  await waitForCondition(
    () => container.textContent?.includes('팀이 잠겼습니다') === true,
    '잠긴 팀 안내 렌더링',
  );
}

describe('ProgramTeamsPage — 초대 검색 자동완성', () => {
  it('신청을 제출해 잠긴 팀에는 초대 패널을 노출하지 않는다', async () => {
    await renderLocked();

    expect(container.querySelector('#invite-search')).toBeNull();
    expect(container.textContent).not.toContain('팀원 초대');
  });

  it('빠르게 입력해도 디바운스 지연이 끝난 뒤 마지막 값으로 한 번만 검색한다', async () => {
    mocks.searchInvitationCandidates.mockResolvedValue([
      candidate('u9', 'octo9'),
    ]);
    await renderReady();

    typeQuery('o');
    act(() => {
      vi.advanceTimersByTime(50);
    });
    typeQuery('oc');
    act(() => {
      vi.advanceTimersByTime(50);
    });
    typeQuery('oct');

    // 아직 300ms(마지막 입력 기준)가 지나지 않았으니 요청이 나가지 않는다.
    expect(mocks.searchInvitationCandidates).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.searchInvitationCandidates).toHaveBeenCalledTimes(1);
    expect(mocks.searchInvitationCandidates).toHaveBeenCalledWith(
      'team-1',
      'oct',
    );
    expect(container.textContent).toContain('octo9');
  });

  it('2자 미만이면 디바운스가 끝나도 요청을 보내지 않는다', async () => {
    await renderReady();

    typeQuery('o');
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(mocks.searchInvitationCandidates).not.toHaveBeenCalled();
  });

  it('늦게 도착한 이전 검색 결과가 최신 검색 결과를 덮어쓰지 않는다', async () => {
    const first = deferred<readonly InvitationCandidate[]>();
    const second = deferred<readonly InvitationCandidate[]>();
    mocks.searchInvitationCandidates
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    await renderReady();

    typeQuery('aa');
    await submitSearch();
    expect(mocks.searchInvitationCandidates).toHaveBeenNthCalledWith(
      1,
      'team-1',
      'aa',
    );

    typeQuery('bb');
    await submitSearch();
    expect(mocks.searchInvitationCandidates).toHaveBeenNthCalledWith(
      2,
      'team-1',
      'bb',
    );

    // 최신 검색(두 번째)이 먼저 응답한다.
    await act(async () => {
      second.resolve([candidate('u2', 'octo2')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('octo2');

    // 이전 검색(첫 번째)이 뒤늦게 도착해도 이미 보여준 최신 결과를 덮어쓰지 않는다.
    await act(async () => {
      first.resolve([candidate('u1', 'octo1-stale')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('octo2');
    expect(container.textContent).not.toContain('octo1-stale');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('늦게 실패한 이전 검색의 오류를 사용자에게 보여주지 않는다', async () => {
    const first = deferred<readonly InvitationCandidate[]>();
    mocks.searchInvitationCandidates
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce([candidate('u2', 'octo2')]);

    await renderReady();

    typeQuery('aa');
    await submitSearch();

    typeQuery('bb');
    await submitSearch();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('octo2');

    // 이전(폐기된) 요청이 뒤늦게 실패해도 화면은 조용히 무시한다 — 에러로 보이지 않는다.
    await act(async () => {
      first.reject(new Error('stale network failure'));
      await Promise.resolve().catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('octo2');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('검색하지 못했습니다');
  });
});
