// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ProblemDetail } from '@/lib/api-client';
import {
  getMyTeam,
  getProgramActivity,
  getProgramDetail,
  leaveMyTeam,
  removeMyTeamMember,
  type ProgramTeam,
} from './api';
import { ProgramMyTeamPage } from './program-my-team-page';
import {
  getMyApplication,
  type StudentApplication,
} from './student-application-api';
import type { ProgramDetail } from './types';
import {
  useTeamInvitationManagement,
  type TeamInvitationManagement,
} from './use-team-invitation-management';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
/**
 * 이 화면은 상위 조합 계층(라우트)이 읽은 신원을 `sessionUser` prop으로만
 * 받는다 — 자기 신원 조회를 다시 만들지 않는다. 그런데 다시 쓰는 팀 관리
 * 컴포넌트(`team-members-panel`·`application-team-departure`)이 아직 공용 세션
 * 저장소를 직접 구독하고 있어, 렌더링만으로 `GET /auth/session` 요직이 나간다.
 *
 * 그 중복 조회는 28이 필수 `sessionNickname` prop으로 감는 것이 실제 수정이고
 * (0-Main 결정), 여기서는 그 동안에도 테스트가 네트워키로 나가지 않도록
 * **정해진 세션 경계 하나**(`useSession`)만 화면에 넘긴 실제 신원으로 실드한다.
 * 일반 fetch를 가짜 성공으로 바꾸거나 콘솔을 억누르지 않는다 — 이 mock은 prop
 * 계약이 들어오면 아무것도 구독하지 않아 자연하게 무해해진다.
 */
vi.mock('@/features/auth/use-session', () => ({
  useSession: mocks.useSession,
}));
vi.mock('./api', () => ({
  getMyTeam: vi.fn(),
  getProgramDetail: vi.fn(),
  getProgramActivity: vi.fn(),
  removeMyTeamMember: vi.fn(),
  leaveMyTeam: vi.fn(),
}));
vi.mock('./student-application-api', () => ({ getMyApplication: vi.fn() }));
vi.mock('./use-team-invitation-management', () => ({
  useTeamInvitationManagement: vi.fn(),
}));

const program: ProgramDetail = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 주관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: '',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2020-01-01T00:00:00Z',
    endsAt: '2099-01-01T00:00:00Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: null },
  milestones: [],
};

/** 팀장 + 팀원 하나. 능력 플래그는 서버가 계산해 내려준 값 그대로 쓴다. */
const team: ProgramTeam = {
  id: 'team-1',
  name: '합성 팀',
  memberCount: 2,
  minMembers: 2,
  maxMembers: 4,
  hasApplication: false,
  canInvite: true,
  canRemoveMembers: true,
  canLeave: true,
  isLeader: true,
  members: [
    {
      userId: 'leader-1',
      nickname: 'synthetic-leader',
      name: null,
      isLeader: true,
    },
    {
      userId: 'member-1',
      nickname: 'synthetic-member',
      name: null,
      isLeader: false,
    },
  ],
};

const application: StudentApplication = {
  id: 'application-1',
  programId: 'program-1',
  status: 'SUBMITTED',
  teamId: 'team-1',
  answers: { applicantName: '합성 학생', title: '합성 신청서' },
  submittedAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  isRepositoryPublicationPlanned: false,
  rejectionReason: null,
  isManager: true,
  canManage: true,
  canEdit: true,
  canCancel: true,
};

function problem(code: string, status = 404, detail = ''): ProblemDetail {
  return {
    type: 'about:blank',
    title: 'Error',
    status,
    detail,
    code,
    instance: 'urn:test',
  };
}

function invitationStub(
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
    onRetrySent: vi.fn(),
    onInviteQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onInvite: vi.fn(),
    onCancelInvitation: vi.fn(),
    reloadSent: vi.fn(async () => {}),
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;
let reloadSent: TeamInvitationManagement['reloadSent'];

/** 화면에 넘긴 신원과 공용 세션 경계의 신원을 항상 같게 맞춘다. */
function seedSession(nickname: string | null): void {
  mocks.useSession.mockReturnValue(
    nickname === null
      ? { status: 'loading', user: null, retry: () => {} }
      : {
          status: 'authenticated',
          user: { nickname, name: null },
          retry: () => {},
        },
  );
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  vi.resetAllMocks();
  seedSession('synthetic-leader');
  reloadSent = vi.fn(async () => {});
  vi.mocked(useTeamInvitationManagement).mockReturnValue(
    invitationStub({ reloadSent }),
  );
  vi.mocked(getProgramDetail).mockResolvedValue(program);
  vi.mocked(getMyTeam).mockResolvedValue(team);
  vi.mocked(getProgramActivity).mockResolvedValue([]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const SLOT_TEXT = '제출 현황 자리';

async function renderPage(
  options: {
    readonly nickname?: string | null;
    readonly submissionContent?: ReactNode;
  } = {},
) {
  const nickname =
    options.nickname === undefined ? 'synthetic-leader' : options.nickname;
  seedSession(nickname);
  await act(async () =>
    root.render(
      <ProgramMyTeamPage
        programId="program-1"
        sessionUser={nickname === null ? null : { nickname, name: null }}
        submissionContent={options.submissionContent ?? <p>{SLOT_TEXT}</p>}
      />,
    ),
  );
}

function button(text: string, dialog = false): HTMLButtonElement {
  const scope = dialog
    ? document.body.querySelector('[role="alertdialog"], [role="dialog"]')
    : host;
  const found = Array.from(scope?.querySelectorAll('button') ?? []).find(
    (item) => item.textContent === text,
  );
  if (!found) throw new Error(`버튼 없음: ${text}`);
  return found as HTMLButtonElement;
}

/** 아이콘 버튼은 글자가 아니라 접근 이름으로 찾는다. */
function iconButton(label: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!found) throw new Error(`아이콘 버튼 없음: ${label}`);
  return found;
}

function inviteDialog(): Element | null {
  // 다이얼로그는 portal로 나갈 수 있으므로 문서 전체에서 찾는다.
  return document.body.querySelector('[role="dialog"]');
}

function applyLink(): Element | null {
  return host.querySelector('a[href="/programs/program-1/apply"]');
}

/** 머리글의 상태 배지 — 없으면 `null`. 명단·카드 안의 배지와 섞이지 않는다. */
function headerBadge(): Element | null {
  return host.querySelector(
    '[data-slot="page-header-actions"] [data-slot="status-badge"]',
  );
}

/** 「신청 상태」 카드 하나 — 카드 머리의 글자로 찾는다. */
function stageCard(): Element {
  const found = Array.from(host.querySelectorAll('[data-slot="card"]')).find(
    (card) =>
      card
        .querySelector('[data-slot="card-title"]')
        ?.textContent?.includes('신청 상태'),
  );
  if (!found) throw new Error('신청 상태 카드 없음');
  return found;
}

describe('ProgramMyTeamPage 접근', () => {
  it('세션 사용자가 없으면 어떤 비공개 조회도 시작하지 않는다', async () => {
    await renderPage({ nickname: null });
    expect(getProgramDetail).not.toHaveBeenCalled();
    expect(getMyTeam).not.toHaveBeenCalled();
    expect(getMyApplication).not.toHaveBeenCalled();
    expect(host.textContent).toContain('불러오는 중');
  });

  it('세션이 뒤늦게 도착하면 그 계정으로 팀을 읽는다', async () => {
    await renderPage({ nickname: null });
    await renderPage();
    expect(getMyTeam).toHaveBeenCalledExactlyOnceWith('program-1');
    expect(host.querySelectorAll('main')).toHaveLength(1);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1')?.textContent).toBe('합성 팀');
  });

  it('머리글은 프로그램만 말하고 인원수는 명단이 한 번만 말한다', async () => {
    await renderPage();
    const heading = host.querySelector('h1');
    const headerText = heading?.parentElement?.textContent ?? '';
    expect(headerText).toContain('합성 프로그램');
    expect(headerText).not.toContain('팀원 2명');
    // 인원수는 명단 카드에 그대로 살아 있다.
    expect(host.textContent).toContain('팀원 2명');
  });

  it('팀이 없으면 신청 화면으로 안내하고 수동 합류를 만들지 않는다', async () => {
    vi.mocked(getMyTeam).mockRejectedValue(new ApiError(problem('TEAM_010')));
    await renderPage();
    expect(host.textContent).toContain('속한 팀이 없습니다');
    expect(applyLink()).not.toBeNull();
    expect(host.textContent).not.toContain('참여 코드');
    expect(getMyApplication).not.toHaveBeenCalled();
  });

  it('프로그램이 없으면 팀 없음으로 접지 않는다', async () => {
    vi.mocked(getProgramDetail).mockRejectedValue(
      new ApiError(problem('PRG_001')),
    );
    vi.mocked(getMyTeam).mockRejectedValue(new ApiError(problem('TEAM_002')));
    await renderPage();
    expect(host.textContent).toContain('프로그램을 찾을 수 없습니다');
    expect(host.textContent).not.toContain('속한 팀이 없습니다');
  });

  it('조회 실패는 빈 팀으로 바꾸지 않고 재시도한다', async () => {
    vi.mocked(getMyTeam).mockRejectedValueOnce(new Error('network'));
    await renderPage();
    expect(host.textContent).toContain('우리 팀을 불러오지 못했습니다');
    expect(host.querySelector('h1')).toBeNull();
    await act(async () => button('다시 시도').click());
    expect(host.querySelector('h1')?.textContent).toBe('합성 팀');
  });
});

describe('ProgramMyTeamPage 신청 상태', () => {
  it('팀장의 미제출 상태는 상태 배지 없이 이어 쓸 자리만 준다', async () => {
    await renderPage();
    // 내지 않은 신청서를 낸 것처럼 말하는 배지를 달지 않는다.
    expect(host.querySelector('[data-slot="page-header-actions"]')).toBeNull();
    expect(host.textContent).not.toContain('신청 작성 중');
    // 없는 신청을 설명하는 사실과 진짜 신청 입구는 그대로 남는다.
    expect(host.textContent).toContain('아직 제출된 신청서가 없습니다');
    expect(host.textContent).toContain('신청서 작성');
    expect(applyLink()).not.toBeNull();
    // 임시 저장이 없는데 있는 것처럼 말하지 않는다.
    expect(host.textContent).toContain('제출 전 내용은 저장되지 않습니다');
    expect(host.textContent).not.toContain('그대로 있습니다');
    expect(getMyApplication).not.toHaveBeenCalled();
  });

  it('초대로 합류한 팀원에게는 팀장 대기만 알리고 중복 동선을 만들지 않는다', async () => {
    vi.mocked(getMyTeam).mockResolvedValue({
      ...team,
      isLeader: false,
      canInvite: false,
      canRemoveMembers: false,
    });
    await renderPage({ nickname: 'synthetic-member' });
    expect(host.querySelector('[data-slot="page-header-actions"]')).toBeNull();
    expect(host.textContent).toContain('신청서는 팀장이 작성해 제출합니다');
    expect(applyLink()).toBeNull();
    expect(host.textContent).not.toContain('신청서 작성');
    expect(host.querySelector('button[aria-label="팀원 초대"]')).toBeNull();
  });

  it('제출된 신청은 서버 상태를 그대로 보여 주고 활동·제출 현황은 열지 않는다', async () => {
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, hasApplication: true });
    vi.mocked(getMyApplication).mockResolvedValue(application);
    await renderPage();
    // 학생이 읽는 표시는 「신청」 하나다 — 검토 단계를 따로 말하지 않는다.
    expect(headerBadge()?.textContent).toBe('신청');
    expect(host.textContent).not.toContain('신청 검토 대기');
    expect(host.textContent).toContain('교직원 검토를 기다리는 중입니다');
    expect(host.textContent).toContain('합성 신청서');
    expect(
      stageCard().querySelector('[data-slot="card-content"]'),
    ).not.toBeNull();
    expect(host.textContent).not.toContain(SLOT_TEXT);
    expect(host.textContent).not.toContain('우리 팀 활동');
    expect(getProgramActivity).not.toHaveBeenCalled();
  });

  it('반려는 서버가 남긴 사유를 그대로 전한다', async () => {
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, hasApplication: true });
    vi.mocked(getMyApplication).mockResolvedValue({
      ...application,
      status: 'REJECTED',
      rejectionReason: '팀 최소 인원을 채우지 못했습니다.',
      canManage: false,
    });
    await renderPage();
    expect(headerBadge()?.textContent).toBe('반려');
    expect(host.textContent).toContain('팀 최소 인원을 채우지 못했습니다.');
    expect(host.textContent).not.toContain(SLOT_TEXT);
  });

  it('신청서가 있다는 팀의 신청 404를 「신청 없음」으로 접지 않는다', async () => {
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, hasApplication: true });
    vi.mocked(getMyApplication).mockRejectedValueOnce(
      new ApiError(problem('APP_001')),
    );
    vi.mocked(getMyApplication).mockResolvedValueOnce(application);
    await renderPage();
    expect(host.textContent).toContain('팀 신청서를 찾지 못했습니다');
    expect(headerBadge()).toBeNull();
    expect(host.textContent).not.toContain('신청서 작성');
    await act(async () => button('다시 시도').click());
    expect(headerBadge()?.textContent).toBe('신청');
  });

  it('승인된 팀에는 실제 활동 집계와 제출 현황 조각을 함께 낸다', async () => {
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, hasApplication: true });
    vi.mocked(getMyApplication).mockResolvedValue({
      ...application,
      status: 'APPROVED',
    });
    vi.mocked(getProgramActivity).mockResolvedValue([
      {
        applicationId: 'application-1',
        label: '합성 팀 저장소',
        commitCount: 12,
        pullRequestCount: 3,
        releaseCount: 1,
        dataAsOf: '2026-01-05T00:00:00Z',
        lastActivityAt: '2026-01-04T00:00:00Z',
      },
    ]);
    await renderPage();
    // 승인도 학생에게는 「신청」으로 읽힌다. 승인이 열어 준 것은 문구가 아니라
    // 아래의 활동 집계·제출 현황 자리다.
    expect(headerBadge()?.textContent).toBe('신청');
    expect(host.textContent).not.toContain('참여 승인');
    // 승인된 팀의 신청 상태 카드는 상태와 제출 사실만 남는다 — 빈 본문을
    // 그려 카드 안에 빈 틈을 만들지 않는다.
    expect(stageCard().querySelector('[data-slot="card-content"]')).toBeNull();
    expect(stageCard().textContent).toContain('합성 신청서');
    expect(stageCard().textContent).toContain('2026년 1월 2일');
    expect(host.textContent).toContain('우리 팀 활동');
    // 제목이 이미 말한 것을 되풀이하는 안내 문단과, 같은 자리에서 제목을 또
    // 세우던 카드 머리(「활동 그래프」)는 남기지 않는다.
    expect(host.textContent).not.toContain('프로그램 전체 활동이 아닙니다');
    expect(host.textContent).not.toContain('활동 그래프');
    expect(host.textContent).not.toContain('아래에서 우리 팀의 저장소 활동');
    expect(host.querySelectorAll('h2')).not.toHaveLength(0);
    expect(host.textContent).toContain('합성 팀 저장소');
    expect(host.textContent).toContain('12');
    expect(host.textContent).toContain('데이터 기준');
    expect(host.textContent).toContain(SLOT_TEXT);
    expect(getProgramActivity).toHaveBeenCalledExactlyOnceWith('program-1');
  });

  it('활동 집계가 비어 있어도 숫자를 지어내지 않는다', async () => {
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, hasApplication: true });
    vi.mocked(getMyApplication).mockResolvedValue({
      ...application,
      status: 'APPROVED',
    });
    await renderPage();
    expect(host.textContent).toContain('아직 연결된 저장소가 없습니다');
  });
});

describe('ProgramMyTeamPage 초대', () => {
  it('초대는 명단의 버튼이 열고 받은 초대함은 두지 않는다', async () => {
    await renderPage();
    expect(inviteDialog()).toBeNull();
    expect(document.body.textContent).not.toContain(
      '이름 또는 GitHub 아이디로 검색',
    );
    await act(async () => iconButton('팀원 초대').click());
    const dialog = inviteDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('이름 또는 GitHub 아이디로 검색');
    expect(host.textContent).not.toContain('받은 초대');
    await act(async () => button('닫기', true).click());
    expect(inviteDialog()).toBeNull();
    expect(document.body.textContent).not.toContain(
      '이름 또는 GitHub 아이디로 검색',
    );
  });

  it('초대 상태는 공통 훅에 현재 팀·세션 신원으로 위임한다', async () => {
    await renderPage();
    expect(useTeamInvitationManagement).toHaveBeenCalledWith({
      programId: 'program-1',
      team: expect.objectContaining({ id: 'team-1' }),
      sessionKey: 'synthetic-leader',
    });
  });

  it('보낸 초대 조회 실패는 훅이 준 이유와 재시도로 드러낸다', async () => {
    const onRetrySent = vi.fn();
    vi.mocked(useTeamInvitationManagement).mockReturnValue(
      invitationStub({
        sentError: '보낸 초대를 불러오지 못했습니다.',
        onRetrySent,
      }),
    );
    await renderPage();
    // 다이얼로그를 열지 않아도 명단이 그 실패를 그대로 드러낸다.
    expect(host.textContent).toContain('보낸 초대를 불러오지 못했습니다');
    await act(async () => button('다시 시도').click());
    expect(onRetrySent).toHaveBeenCalledOnce();
  });

  it('초대 권한이 없으면 여는 버튼 자체를 두지 않는다', async () => {
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, canInvite: false });
    await renderPage();
    expect(host.querySelector('button[aria-label="팀원 초대"]')).toBeNull();
    expect(inviteDialog()).toBeNull();
  });
});

describe('ProgramMyTeamPage 팀 구성 변경', () => {
  it('팀원 제외가 성공하면 현재 팀과 초대 현황을 다시 읽는다', async () => {
    vi.mocked(removeMyTeamMember).mockResolvedValue(undefined);
    await renderPage();
    expect(getMyTeam).toHaveBeenCalledOnce();
    await act(async () => iconButton('synthetic-member 팀에서 제외').click());
    await act(async () => button('팀에서 제외', true).click());
    expect(removeMyTeamMember).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      'member-1',
    );
    expect(getMyTeam).toHaveBeenCalledTimes(2);
    expect(reloadSent).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('본인 탈퇴가 성공하면 현재 신원으로 대시보드로 나간다', async () => {
    vi.mocked(leaveMyTeam).mockResolvedValue(undefined);
    await renderPage();
    const details = host.querySelector('details');
    if (details) details.open = true;
    await act(async () => button('팀 탈퇴').click());
    await act(async () => button('팀 탈퇴', true).click());
    expect(leaveMyTeam).toHaveBeenCalledExactlyOnceWith('program-1');
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/dashboard');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});

describe('ProgramMyTeamPage 신원·범위 격리', () => {
  it('늦게 도착한 이전 계정의 응답으로 화면을 갱신하지 않는다', async () => {
    let resolveFirst!: (value: ProgramDetail) => void;
    vi.mocked(getProgramDetail).mockImplementationOnce(
      () =>
        new Promise<ProgramDetail>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await renderPage();
    expect(host.textContent).toContain('불러오는 중');

    vi.mocked(getProgramDetail).mockResolvedValue({
      ...program,
      name: '두 번째 계정 프로그램',
    });
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, name: '두 번째 팀' });
    await renderPage({ nickname: 'other-account' });
    expect(host.querySelector('h1')?.textContent).toBe('두 번째 팀');

    await act(async () =>
      resolveFirst({ ...program, name: '첫 번째 계정 프로그램' }),
    );
    expect(host.textContent).not.toContain('첫 번째 계정 프로그램');
    expect(host.textContent).toContain('두 번째 계정 프로그램');
    expect(useTeamInvitationManagement).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionKey: 'other-account' }),
    );
  });

  it('프로그램이 바뀌면 이전 프로그램의 팀을 남겨 두지 않는다', async () => {
    await renderPage();
    expect(host.querySelector('h1')?.textContent).toBe('합성 팀');
    vi.mocked(getMyTeam).mockResolvedValue({ ...team, name: '다른 팀' });
    vi.mocked(getProgramDetail).mockResolvedValue({
      ...program,
      id: 'program-2',
      name: '다른 프로그램',
    });
    await act(async () =>
      root.render(
        <ProgramMyTeamPage
          programId="program-2"
          sessionUser={{ nickname: 'synthetic-leader', name: null }}
          submissionContent={<p>{SLOT_TEXT}</p>}
        />,
      ),
    );
    expect(getMyTeam).toHaveBeenLastCalledWith('program-2');
    expect(host.querySelector('h1')?.textContent).toBe('다른 팀');
  });
});
