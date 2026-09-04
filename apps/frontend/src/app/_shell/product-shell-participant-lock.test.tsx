// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { ProgramOverview } from '@/features/programs/program-overview-api';

/**
 * `product-shell.test.tsx`는 `renderToStaticMarkup`으로 돌아 **effect가 실행되지 않는다** —
 * 참여 여부는 effect 안에서 읽으므로 그 파일에서는 언제나 「아직 모른다」에 머문다.
 * 잠금이 실제로 화면까지 닿는지는 effect가 도는 이 파일에서만 확인할 수 있다(#1099).
 */

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
  // 승인 전 학생에게도 개요는 0/2를 준다 — 이 값만으로는 참여자와 구분되지 않는다.
  viewerDocumentsCompleted: 0,
  viewerDocumentsTotal: 2,
  fullySubmittedParticipantCount: null,
  nextMilestone: null,
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

describe('ProductShell 좌측 패널 잠금(#1099)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mockSession('STUDENT');
    mocks.usePathname.mockReturnValue('/programs/prog-1');
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

  it('신청한 적 없는 학생은 두 메뉴를 보되 누를 수 없다', async () => {
    mocks.getMyApplication.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'APP_001',
        status: 404,
        detail: '신청을 찾을 수 없습니다.',
        instance: '/synthetic/programs/prog-1/applications/me',
        code: 'APP_001',
      }),
    );

    await renderShell();

    expect(container.textContent).toContain('내 제출물');
    expect(container.textContent).toContain('게시판');
    expect(hrefs()).not.toContain('/programs/prog-1/documents');
    expect(hrefs()).not.toContain('/programs/prog-1/board');
    expect(
      container.querySelectorAll('[data-slot="program-scope-sidebar-locked"]'),
    ).toHaveLength(2);
    expect(container.textContent).toContain('승인 후');
  });

  it('신청했지만 아직 승인 전인 학생도 잠긴 채로 본다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'SUBMITTED' });

    await renderShell();

    expect(hrefs()).not.toContain('/programs/prog-1/documents');
    expect(container.textContent).toContain('승인 후');
  });

  it('승인된 신청이 있는 학생에게는 지금과 똑같이 열린다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });

    await renderShell();

    expect(hrefs()).toContain('/programs/prog-1/documents');
    expect(hrefs()).toContain('/programs/prog-1/board');
    expect(container.textContent).not.toContain('승인 후');
    expect(container.textContent).toContain('0/2');
    // 단계 자식도 그대로 펴진다.
    expect(container.textContent).toContain('스터디 계획서');
  });

  it('교직원 좌측 패널은 참여 여부를 묻지도, 잠기지도 않는다', async () => {
    mockSession('STAFF');

    await renderShell();

    expect(mocks.getMyApplication).not.toHaveBeenCalled();
    expect(container.textContent).toContain('서류 현황');
    expect(container.textContent).not.toContain('승인 후');
    expect(hrefs()).toContain('/programs/prog-1/documents');
    expect(hrefs()).toContain('/programs/prog-1/board');
  });
});
