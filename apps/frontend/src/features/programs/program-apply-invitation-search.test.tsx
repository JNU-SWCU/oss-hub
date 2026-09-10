// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTeam, removeMyTeamMember, type ProgramTeam } from './api';
import {
  loadProgramApplyContext,
  type ProgramApplyContext,
} from './load-program-apply-context';
import { ProgramApplyPage } from './program-apply-page';
import type {
  InvitationCandidate,
  SentTeamInvitation,
} from './team-invitation-api';
import {
  cancelInvitation,
  createInvitation,
  listSentInvitations,
  searchInvitationCandidates,
} from './team-invitation-api';
import type { ProgramDetail } from './types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { readonly href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('./load-program-apply-context', () => ({
  loadProgramApplyContext: vi.fn(),
}));

vi.mock('./api', () => ({
  createApplication: vi.fn(),
  createTeam: vi.fn(),
  removeMyTeamMember: vi.fn(),
}));

vi.mock('./student-application-api', () => ({
  cancelMyApplication: vi.fn(),
  updateMyApplication: vi.fn(),
}));

vi.mock('./team-invitation-api', () => ({
  listSentInvitations: vi.fn(),
  searchInvitationCandidates: vi.fn(),
  createInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
}));

const loadProgramApplyContextMock = vi.mocked(loadProgramApplyContext);
const listSentInvitationsMock = vi.mocked(listSentInvitations);
const searchInvitationCandidatesMock = vi.mocked(searchInvitationCandidates);
const createInvitationMock = vi.mocked(createInvitation);
const cancelInvitationMock = vi.mocked(cancelInvitation);
const removeMyTeamMemberMock = vi.mocked(removeMyTeamMember);
const createTeamMock = vi.mocked(createTeam);

const sessionUser = {
  name: '합성 학생',
  nickname: 'synthetic-student',
} as const;

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 팀 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'oss-contest',
  lifecycle: 'PUBLISHED',
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
  hasApplication: false,
  canInvite: true,
  canRemoveMembers: true,
  canLeave: true,
  isLeader: true,
  members: [
    {
      userId: 'u1',
      nickname: 'synthetic-student',
      name: '합성 학생',
      isLeader: true,
    },
  ],
};

const sentInvitations: readonly SentTeamInvitation[] = [];

type ReadyContext = Extract<ProgramApplyContext, { readonly kind: 'ready' }>;

function readyContext(nextTeam: ProgramTeam | null): ReadyContext {
  return {
    kind: 'ready',
    mode: 'create',
    program,
    template: {
      key: 'oss-contest',
      version: 1,
      name: 'OSS경진대회 신청서',
      participation: 'team',
      fields: [
        { key: 'applicantName', type: 'auto', label: '신청자', required: true },
      ],
    },
    applicantName: '합성 학생',
    githubHandle: 'synthetic-student',
    teamId: nextTeam?.id ?? null,
    teamMinimum: null,
    team: nextTeam,
    applicationId: null,
    canManage: true,
    initialValues: {
      isRepositoryPublicationPlanned: true,
      repositoryConnectionMode: 'new',
      repositoryUrl: '',
      personalDataConsent: false,
    },
  };
}

function candidate(id: string, nickname: string): InvitationCandidate {
  return { id, nickname, name: null, avatarUrl: null };
}

function pendingInvitation(id: string, nickname: string): SentTeamInvitation {
  return {
    id,
    teamId: team.id,
    programId: program.id,
    invitedById: 'u1',
    status: 'PENDING',
    invitedAt: '2026-07-02T00:00:00.000Z',
    respondedAt: null,
    invitee: { id: 'u9', nickname, name: null, avatarUrl: null },
  };
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

  loadProgramApplyContextMock.mockReset().mockResolvedValue(readyContext(team));
  listSentInvitationsMock.mockReset().mockResolvedValue(sentInvitations);
  searchInvitationCandidatesMock.mockReset();
  createInvitationMock.mockReset();
  cancelInvitationMock.mockReset();
  createTeamMock.mockReset();
  removeMyTeamMemberMock.mockReset().mockResolvedValue(undefined);
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

/** 초대 레이어는 Radix Dialog 포털이라 컨테이너 밖(document)에 열린다. */
function searchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('#invite-search');
}

function requireSearchInput(): HTMLInputElement {
  const input = searchInput();
  if (!input) throw new Error('검색 입력을 찾지 못했다.');
  return input;
}

function inviteTrigger(): HTMLButtonElement {
  const target = container.querySelector('button[aria-label="팀원 초대"]');
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error('초대(＋) 트리거를 찾지 못했다.');
  }
  return target;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!found) throw new Error(`버튼을 찾지 못했다: ${text}`);
  return found;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = document.querySelector(`button[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`버튼을 찾지 못했다: ${label}`);
  }
  return found;
}

/** React가 듣는 것은 네이티브 input 이벤트라 setter를 직접 호출해 값을 넣는다. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function typeQuery(value: string): void {
  typeInto(requireSearchInput(), value);
}

/** 디바운스(300ms)를 흘려보내 실제 검색 한 번을 돌린다 — 화면에 검색 버튼은 없다. */
async function runDebouncedSearch(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dialogContent(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

async function renderPage(): Promise<void> {
  act(() => {
    root.render(
      <ProgramApplyPage programId="program-1" sessionUser={sessionUser} />,
    );
  });
  await waitForCondition(
    () => container.querySelector('#apply-team-name') !== null,
    '신청 화면 렌더링',
  );
}

/** 저장된 팀이 있는 화면에서 초대 레이어를 연다. */
async function openInviteDialog(): Promise<void> {
  await act(async () => {
    inviteTrigger().click();
    await Promise.resolve();
  });
  await waitForCondition(() => searchInput() !== null, '초대 레이어 열림');
}

describe('ProgramApplyPage — 초대 검색', () => {
  it('신청을 제출해 초대 권한이 없는 팀에는 초대 트리거도 조회도 없다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext({
        ...team,
        hasApplication: true,
        canInvite: false,
        canRemoveMembers: false,
        canLeave: false,
      }),
    );
    await renderPage();

    expect(
      container.querySelector('button[aria-label="팀원 초대"]'),
    ).toBeNull();
    expect(searchInput()).toBeNull();
    expect(container.textContent).toContain('오픈소스팀');
    expect(listSentInvitationsMock).not.toHaveBeenCalled();
    expect(searchInvitationCandidatesMock).not.toHaveBeenCalled();
  });

  it('팀이 없으면 ＋가 먼저 팀을 만들고, 그 팀으로 검색한다', async () => {
    loadProgramApplyContextMock
      .mockReset()
      .mockResolvedValueOnce(readyContext(null))
      .mockResolvedValue(readyContext(team));
    createTeamMock.mockResolvedValue({
      id: team.id,
      name: team.name,
      memberCount: 1,
    });
    searchInvitationCandidatesMock.mockResolvedValue([
      candidate('u9', 'octo9'),
    ]);
    await renderPage();

    // 팀이 없는 동안에는 보낸 초대도 검색도 없다.
    expect(listSentInvitationsMock).not.toHaveBeenCalled();

    const teamNameInput =
      container.querySelector<HTMLInputElement>('#apply-team-name');
    if (!teamNameInput) throw new Error('팀 이름 입력을 찾지 못했다.');
    typeInto(teamNameInput, '오픈소스팀');
    await openInviteDialog();

    expect(createTeamMock).toHaveBeenCalledExactlyOnceWith('program-1', {
      name: '오픈소스팀',
    });

    typeQuery('oc');
    await runDebouncedSearch();

    expect(searchInvitationCandidatesMock).toHaveBeenCalledExactlyOnceWith(
      'team-1',
      'oc',
    );
    expect(document.body.textContent).toContain('octo9');
    // 검색까지 왔어도 초대는 아직 보내지 않았고 신청도 만들지 않았다.
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it('빠르게 입력해도 디바운스 지연이 끝난 뒤 마지막 값으로 한 번만 검색한다', async () => {
    searchInvitationCandidatesMock.mockResolvedValue([
      candidate('u9', 'octo9'),
    ]);
    await renderPage();
    await openInviteDialog();

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
    expect(searchInvitationCandidatesMock).not.toHaveBeenCalled();

    await runDebouncedSearch();

    expect(searchInvitationCandidatesMock).toHaveBeenCalledTimes(1);
    expect(searchInvitationCandidatesMock).toHaveBeenCalledWith(
      'team-1',
      'oct',
    );
    expect(document.body.textContent).toContain('octo9');
  });

  it('2자 미만이면 디바운스가 끝나도 요청을 보내지 않는다', async () => {
    await renderPage();
    await openInviteDialog();

    typeQuery('o');
    await runDebouncedSearch();

    expect(searchInvitationCandidatesMock).not.toHaveBeenCalled();
  });

  it('늦게 도착한 이전 검색 결과가 최신 검색 결과를 덮어쓰지 않는다', async () => {
    const first = deferred<readonly InvitationCandidate[]>();
    const second = deferred<readonly InvitationCandidate[]>();
    searchInvitationCandidatesMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    await renderPage();
    await openInviteDialog();

    typeQuery('aa');
    await runDebouncedSearch();
    expect(searchInvitationCandidatesMock).toHaveBeenNthCalledWith(
      1,
      'team-1',
      'aa',
    );

    typeQuery('bb');
    await runDebouncedSearch();
    expect(searchInvitationCandidatesMock).toHaveBeenNthCalledWith(
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
    expect(document.body.textContent).toContain('octo2');

    // 이전 검색(첫 번째)이 뒤늦게 도착해도 이미 보여준 최신 결과를 덮어쓰지 않는다.
    await act(async () => {
      first.resolve([candidate('u1', 'octo1-stale')]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('octo2');
    expect(document.body.textContent).not.toContain('octo1-stale');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('검색 결과에서 초대하면 실제 초대 API를 부르고 보낸 초대를 다시 읽는다', async () => {
    searchInvitationCandidatesMock.mockResolvedValue([
      candidate('u9', 'octo9'),
    ]);
    createInvitationMock.mockResolvedValue(pendingInvitation('inv-1', 'octo9'));
    listSentInvitationsMock
      .mockResolvedValueOnce([])
      .mockResolvedValue([pendingInvitation('inv-1', 'octo9')]);
    await renderPage();
    await openInviteDialog();

    typeQuery('oc');
    await runDebouncedSearch();
    expect(document.body.textContent).toContain('octo9');

    const initialSentReads = listSentInvitationsMock.mock.calls.length;
    await act(async () => {
      buttonByText('초대').click();
    });
    await waitForCondition(
      () => listSentInvitationsMock.mock.calls.length > initialSentReads,
      '초대 후 보낸 초대 재조회',
    );

    expect(createInvitationMock).toHaveBeenCalledExactlyOnceWith(
      'team-1',
      'u9',
    );
    // 표시 이름은 서버의 invitee projection이 정답이라 다시 읽는다.
    expect(listSentInvitationsMock).toHaveBeenLastCalledWith('team-1');
  });

  it('대기 중인 초대는 로스터에서 취소하고, 레이어는 그 목록을 다시 그리지 않는다', async () => {
    listSentInvitationsMock
      .mockReset()
      .mockResolvedValue([pendingInvitation('inv-1', 'octo9')]);
    cancelInvitationMock.mockResolvedValue(undefined);
    await renderPage();
    await waitForCondition(
      () => container.textContent?.includes('octo9') === true,
      '대기 중 초대 행',
    );

    await act(async () => {
      buttonByLabel('octo9 초대 취소').click();
    });
    await waitForCondition(
      () => cancelInvitationMock.mock.calls.length === 1,
      '초대 취소 요청',
    );

    expect(cancelInvitationMock).toHaveBeenCalledExactlyOnceWith('inv-1');
    // 대기 행은 로스터의 것이다 — 검색 레이어는 아직 열리지도 않았다.
    expect(searchInput()).toBeNull();
  });

  it('초대 레이어를 닫아도 신청 화면과 입력은 그대로 남는다', async () => {
    await renderPage();
    await openInviteDialog();
    expect(dialogContent()).not.toBeNull();

    await act(async () => {
      buttonByText('닫기').click();
      await Promise.resolve();
    });
    await waitForCondition(() => searchInput() === null, '초대 레이어 닫힘');

    expect(container.textContent).toContain('오픈소스팀');
    expect(container.querySelector('#personal-data-consent')).not.toBeNull();
  });

  it('신청 화면에는 팀원 제외 컨트롤이 없다', async () => {
    loadProgramApplyContextMock.mockResolvedValue(
      readyContext({
        ...team,
        memberCount: 2,
        members: [
          ...team.members,
          {
            userId: 'u2',
            nickname: 'member-nick',
            name: '팀원',
            isLeader: false,
          },
        ],
      }),
    );
    await renderPage();

    expect(container.textContent).toContain('member-nick');
    expect(
      container.querySelector('button[aria-label="팀원 팀에서 제외"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain('팀에서 제외');
    expect(removeMyTeamMemberMock).not.toHaveBeenCalled();
  });

  it('늦게 실패한 이전 검색의 오류를 사용자에게 보여주지 않는다', async () => {
    const first = deferred<readonly InvitationCandidate[]>();
    searchInvitationCandidatesMock
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce([candidate('u2', 'octo2')]);

    await renderPage();
    await openInviteDialog();

    typeQuery('aa');
    await runDebouncedSearch();

    typeQuery('bb');
    await runDebouncedSearch();
    expect(document.body.textContent).toContain('octo2');

    // 이전(폐기된) 요청이 뒤늦게 실패해도 화면은 조용히 무시한다 — 에러로 보이지 않는다.
    await act(async () => {
      first.reject(new Error('stale network failure'));
      await Promise.resolve().catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('octo2');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).not.toContain('검색하지 못했습니다');
  });
});
