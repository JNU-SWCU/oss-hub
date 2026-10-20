import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramOverview } from '@/features/programs/program-overview-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(() => '/programs/prog-1'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useSessionRole: vi.fn(),
  getProgramOverview: vi.fn(),
  getProgramNavigationMilestones: vi.fn(),
  getMyApplication: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    scroll,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
    scroll?: boolean;
  }) => (
    <a
      href={href}
      data-scroll={scroll === false ? 'false' : undefined}
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock('./use-session-role', () => ({ useSessionRole: mocks.useSessionRole }));
vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));
vi.mock('@/features/programs/student-application-api', () => ({
  getMyApplication: mocks.getMyApplication,
}));

import { ProductShell } from './product-shell';

const OVERVIEW: ProgramOverview = {
  programId: 'prog-1',
  name: '합성 기초 스터디',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  milestoneCount: 2,
  boardPostCount: 0,
  participantCount: 3,
  teamCount: 0,
  connectedRepositoryCount: 0,
  viewerRole: 'STUDENT',

  viewerDocumentsCompleted: 0,
  viewerDocumentsTotal: 2,
  fullySubmittedParticipantCount: null,
  remainingMilestones: [],
  milestoneDocuments: [
    { milestoneId: 'm1', title: '스터디 계획서', completed: 0, total: 1 },
  ],
};

function mockSession(role: 'STUDENT' | 'STAFF') {
  mocks.useSessionRole.mockReturnValue({
    status: 'assigned',
    role,
    staffAccessRequestStatus: null,
    selectedRole: null,
    memberKind: role,
    hasStaffAccess: role === 'STAFF',
    hasAdminAccess: false,
    isProfileComplete: true,
    retry: () => {},
  });
}

function mockStudentAdminSession() {
  mocks.useSessionRole.mockReturnValue({
    status: 'assigned',
    role: 'STUDENT',
    staffAccessRequestStatus: null,
    selectedRole: null,
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: true,
    isProfileComplete: true,
    retry: () => {},
  });
}

function mockAnonymousSession() {
  mocks.useSessionRole.mockReturnValue({
    status: 'anonymous',
    role: null,
    staffAccessRequestStatus: null,
    selectedRole: null,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: false,
    retry: () => {},
  });
}

describe('ProductShell 좌측 패널 — 참여자 전용 메뉴(#1099)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mockSession('STUDENT');
    mocks.usePathname.mockReturnValue('/programs/prog-1');
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mocks.getProgramOverview.mockResolvedValue(OVERVIEW);
    mocks.getProgramNavigationMilestones.mockResolvedValue([
      { milestoneId: 'm1', title: '스터디 계획서', submissionEnabled: true },
    ]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function renderShell() {
    await act(async () => {
      root.render(
        <ProductShell>
          <p>본문</p>
        </ProductShell>,
      );
    });
  }

  function hrefs(): readonly string[] {
    return [...container.querySelectorAll('a')].map(
      (anchor) => anchor.getAttribute('href') ?? '',
    );
  }

  function sidebarText(): string {
    return (
      container.querySelector('[data-slot="program-scope-sidebar-nav"]')
        ?.textContent ?? ''
    );
  }

  const NOT_APPLIED = null;

  it('신청한 적 없는 학생에게는 두 메뉴가 아예 없다', async () => {
    mocks.getMyApplication.mockResolvedValue(NOT_APPLIED);

    await renderShell();

    expect(sidebarText()).not.toContain('내 제출물');
    expect(sidebarText()).not.toContain('게시판');
    expect(hrefs()).not.toContain('/programs/prog-1/documents');
    expect(hrefs()).not.toContain('/programs/prog-1/board');

    expect(hrefs()).toContain('/programs/prog-1');
    expect(hrefs()).toContain('/programs/prog-1/teams');
  });

  it('잠금 딱지를 대신 남기지 않는다 — 두 방식이 공존하지 않는다', async () => {
    mocks.getMyApplication.mockResolvedValue(NOT_APPLIED);

    await renderShell();

    expect(container.textContent).not.toContain('승인 후');
    expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
  });

  it('신청했지만 아직 승인 전인 학생에게도 없다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'SUBMITTED' });

    await renderShell();

    expect(sidebarText()).not.toContain('내 제출물');
    expect(hrefs()).not.toContain('/programs/prog-1/documents');
    expect(hrefs()).not.toContain('/programs/prog-1/board');
  });

  it('승인된 신청이 있는 학생에게는 지금과 똑같이 열린다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });

    await renderShell();

    expect(hrefs()).toContain('/programs/prog-1/documents');
    expect(hrefs()).toContain('/programs/prog-1/board');
    expect(sidebarText()).toContain('0/2');

    expect(sidebarText()).toContain('스터디 계획서');
  });

  it('교직원 권한 참여 학생은 기본 학생 메뉴와 명시적 운영 전환을 제공한다', async () => {
    mockSession('STUDENT');
    mocks.useSessionRole.mockReturnValue({
      ...mocks.useSessionRole(),
      hasStaffAccess: true,
    });
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await renderShell();
    expect(sidebarText()).toContain('내 제출물');
    expect(sidebarText()).toContain('우리 팀');
    expect(sidebarText()).not.toContain('팀 관리');
    expect(hrefs()).toContain('/programs/prog-1?view=operations');
  });

  it('명시적 운영 화면은 이동 중에도 운영 상태를 유지하고 학생 화면으로 돌아갈 수 있다', async () => {
    mockSession('STUDENT');
    mocks.useSessionRole.mockReturnValue({
      ...mocks.useSessionRole(),
      hasStaffAccess: true,
    });
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    mocks.useSearchParams.mockReturnValue(
      new URLSearchParams('view=operations'),
    );
    await renderShell();
    expect(sidebarText()).toContain('서류 현황');
    expect(sidebarText()).toContain('팀 관리');
    expect(hrefs()).toContain('/programs/prog-1/documents?view=operations');
    expect(hrefs()).toContain(
      '/programs/prog-1/documents?milestoneId=m1&view=operations',
    );
    const studentLink = [...container.querySelectorAll('a')].find(
      (a) => a.textContent === '학생 화면으로 전환',
    );
    expect(studentLink?.getAttribute('href')).toBe('/programs/prog-1');
  });

  it.each([
    '/programs/prog-1/milestones/m1/documents',
    '/programs/prog-1/submissions/s1/review',
    '/programs/prog-1/teams/team-1',
    '/programs/prog-1/edit',
  ])(
    '운영 도구 내부 링크 %s에서도 운영 메뉴와 복귀 경로를 유지한다',
    async (pathname) => {
      mockStudentAdminSession();
      mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
      mocks.usePathname.mockReturnValue(pathname);
      await renderShell();
      expect(sidebarText()).toContain('서류 현황');
      expect(sidebarText()).toContain('학생 화면으로 전환');
      expect(hrefs()).toContain('/programs/prog-1/documents?view=operations');
    },
  );

  it('교직원 좌측 패널은 참여 여부를 묻지도, 달라지지도 않는다', async () => {
    mockSession('STAFF');

    await renderShell();

    expect(mocks.getMyApplication).not.toHaveBeenCalled();
    expect(sidebarText()).toContain('서류 현황');
    expect(sidebarText()).toContain('팀 관리');
    expect(hrefs()).toContain('/programs/prog-1/documents');
    expect(hrefs()).toContain('/programs/prog-1/board');
  });

  describe('학생 관리자(미신청)', () => {
    beforeEach(() => {
      mockStudentAdminSession();
      mocks.getMyApplication.mockResolvedValue(NOT_APPLIED);
    });

    it('게시판은 남는다 — 관리자 접근으로 실제로 열리는 화면이다', async () => {
      await renderShell();

      expect(sidebarText()).toContain('게시판');
      expect(hrefs()).toContain('/programs/prog-1/board');
    });

    it('내 제출물 대신 운영 서류 현황을 제공한다', async () => {
      await renderShell();

      expect(sidebarText()).not.toContain('내 제출물');
      expect(sidebarText()).toContain('서류 현황');
      expect(hrefs()).toContain('/programs/prog-1/documents');
    });

    it('참여하지 않은 운영자는 운영 메뉴를 기본으로 본다', async () => {
      await renderShell();

      expect(mocks.getMyApplication).toHaveBeenCalledWith('prog-1');
      expect(sidebarText()).toContain('서류 현황');
      expect(sidebarText()).toContain('팀 관리');
      expect(sidebarText()).not.toContain('학생 화면으로 전환');
      expect(hrefs()).not.toContain('/programs/prog-1/applicants');

      expect(hrefs()).toContain('/programs/prog-1');
      expect(hrefs()).toContain('/programs/prog-1/teams');
    });
  });

  it.each([
    ['교직원', true, false],
    ['운영자', false, true],
  ] as const)(
    '%s의 참여 조회 실패를 학생 참여로 간주하지 않는다',
    async (_role, hasStaffAccess, hasAdminAccess) => {
      mockSession('STUDENT');
      mocks.useSessionRole.mockReturnValue({
        ...mocks.useSessionRole(),
        hasStaffAccess,
        hasAdminAccess,
      });
      mocks.getMyApplication.mockRejectedValue(new TypeError('unavailable'));

      await renderShell();

      expect(sidebarText()).toContain('팀 관리');
      expect(sidebarText()).not.toContain('우리 팀');
      expect(sidebarText()).not.toContain('학생 화면으로 전환');
    },
  );

  it('참여 조회 대기 중에는 운영 화면을 유지하고 전환 버튼을 제공하지 않는다', async () => {
    mockStudentAdminSession();
    mocks.getMyApplication.mockReturnValue(new Promise(() => {}));

    await renderShell();

    expect(sidebarText()).toContain('팀 관리');
    expect(sidebarText()).not.toContain('우리 팀');
    expect(sidebarText()).not.toContain('학생 화면으로 전환');
  });

  it.each(['SUBMITTED', 'REJECTED'])(
    '%s 신청의 혼합 권한 계정은 승인 참여가 아니므로 운영 화면을 본다',
    async (status) => {
      mockStudentAdminSession();
      mocks.getMyApplication.mockResolvedValue({ status });

      await renderShell();

      expect(sidebarText()).toContain('팀 관리');
      expect(sidebarText()).not.toContain('우리 팀');
      expect(sidebarText()).not.toContain('학생 화면으로 전환');
    },
  );

  it('비회원 좌측 패널도 그대로다 — 원래 개요 하나뿐이고 참여 여부를 묻지 않는다', async () => {
    mockAnonymousSession();

    await renderShell();

    expect(mocks.getMyApplication).not.toHaveBeenCalled();
    expect(hrefs()).toContain('/programs/prog-1');
    expect(hrefs()).not.toContain('/programs/prog-1/teams');
    expect(sidebarText()).not.toContain('내 제출물');
    expect(sidebarText()).not.toContain('게시판');
  });
});
