import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetail } from '@/features/programs/catalog/dto';
import type { ProgramOverview } from '@/features/programs/catalog/program-overview-dto';
import { ApiError } from '@/lib/api-client';
import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../../test-support/render-with-query';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  hasStaffAccess: true,
  hasAdminAccess: false,
  memberKind: 'STUDENT',
  getMyApplication: vi.fn(),
  getProgramOverview: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/programs/program-1',
  useSearchParams: () => mocks.searchParams,
  useRouter: () => mocks.router,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    scroll,
    ...props
  }: React.ComponentProps<'a'> & { readonly scroll?: boolean }) => (
    <a
      href={href}
      data-scroll={scroll === false ? 'false' : undefined}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/features/auth/use-session', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));
vi.mock('../../_shell/use-session-role', () => ({
  useSessionRole: () => ({
    status: 'assigned',
    memberKind: mocks.memberKind,
    hasStaffAccess: mocks.hasStaffAccess,
    hasAdminAccess: mocks.hasAdminAccess,
    isProfileComplete: true,
  }),
}));
vi.mock('@/features/programs/applications/student-application-api', () => ({
  getMyApplication: mocks.getMyApplication,
}));
vi.mock('@/features/programs/catalog/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/catalog/program-navigation-api', () => ({
  getProgramNavigationMilestones: async () => [
    { milestoneId: 'milestone-1', title: '합성 단계', submissionEnabled: true },
  ],
}));
vi.mock('@/features/programs/catalog/components/activity-graph-panel', () => ({
  ActivityGraphPanel: () => null,
}));

import { ProductShell } from '../../_shell/product-shell';
import { setProgramOperationsView } from '../../_shell/program-operations-view';
import { ProgramDetailScreen } from './program-detail-screen';

const DETAIL = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 기관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  description: '',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
  milestones: [],
} as const satisfies ProgramDetail;

describe('프로그램 상세와 셸의 참여 화면 일치', () => {
  let queryClient = createTestQueryClient();
  let root: Root;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    notifyManager.setScheduler(queueMicrotask);
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.hasStaffAccess = true;
    mocks.hasAdminAccess = false;
    mocks.memberKind = 'STUDENT';
    mocks.searchParams = new URLSearchParams();
    mocks.getMyApplication.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Unavailable',
        detail: '참여 정보를 불러오지 못했습니다.',
        status: 503,
        code: 'UNAVAILABLE',
        instance: '/programs/program-1/applications/me',
      }),
    );
    mocks.getProgramOverview.mockRejectedValue(new TypeError('unavailable'));
    fetchMock = vi.fn(async () => {
      const role =
        mocks.memberKind === 'STAFF' && mocks.hasStaffAccess
          ? 'STAFF'
          : 'STUDENT';
      return new Response(
        JSON.stringify({
          ...DETAIL,
          viewer: { ...DETAIL.viewer, role },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setProgramOperationsView('program-1', false);
    vi.clearAllMocks();
    queryClient.clear();
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  });

  async function renderScreen() {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProductShell>
            <ProgramDetailScreen programId="program-1" />
          </ProductShell>
        </QueryClientProvider>,
      ),
    );
  }

  it.each(['staff', 'student', 'dual'] as const)(
    '%s 상세와 셸은 같은 overview 요청 하나만 공유한다',
    async (role) => {
      mocks.memberKind = role === 'staff' ? 'STAFF' : 'STUDENT';
      mocks.hasStaffAccess = role !== 'student';
      let resolveParticipation: (value: { status: string }) => void = () => {
        throw new TypeError('participation request missing');
      };
      mocks.getMyApplication.mockReturnValue(
        new Promise<{ status: string }>((resolve) => {
          resolveParticipation = resolve;
        }),
      );
      await renderScreen();
      if (role !== 'staff') {
        await act(async () => resolveParticipation({ status: 'APPROVED' }));
      }
      expect(mocks.getProgramOverview).toHaveBeenCalledTimes(1);
      expect(mocks.getProgramOverview).toHaveBeenCalledWith(
        'program-1',
        role === 'staff',
      );
    },
  );

  function editLink(): Element | null {
    return container.querySelector('main a[href$="/edit"]');
  }

  it.each(['STAFF', 'ADMIN'] as const)(
    '참여 조회 503 뒤 %s 메뉴와 본문을 함께 보여준다',
    async (role) => {
      mocks.memberKind = role === 'STAFF' ? 'STAFF' : 'STUDENT';
      mocks.hasStaffAccess = role === 'STAFF';
      mocks.hasAdminAccess = role === 'ADMIN';
      await renderScreen();
      expect(container.textContent?.includes('팀 관리')).toBe(role === 'STAFF');
      expect(editLink() !== null).toBe(role === 'STAFF');
      expect(mocks.getProgramOverview).toHaveBeenCalledWith(
        'program-1',
        role === 'STAFF',
      );
    },
  );

  it('실제 신분이 바뀔 때만 학생과 운영 도구를 전환한다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await renderScreen();
    expect(container.textContent).toContain('우리 팀');
    expect(editLink()).toBeNull();
    mocks.memberKind = 'STAFF';
    await renderScreen();
    expect(container.textContent).toContain('팀 관리');
    expect(editLink()).not.toBeNull();
    mocks.memberKind = 'STUDENT';
    await renderScreen();
    expect(container.textContent).toContain('우리 팀');
    expect(editLink()).toBeNull();
    expect(container.querySelector('button[data-view-switch]')).toBeNull();
  });

  it('학생의 저장된 운영 값은 hydration 뒤에도 운영 도구를 열지 않는다', async () => {
    sessionStorage.setItem('oss-hub-program-operations-view:program-1', 'true');
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await act(async () => root.unmount());
    const screen = (
      <QueryClientProvider client={queryClient}>
        <ProductShell>
          <ProgramDetailScreen programId="program-1" />
        </ProductShell>
      </QueryClientProvider>
    );
    container.innerHTML = renderToString(screen);
    expect(container.textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getProgramOverview).not.toHaveBeenCalled();
    await act(async () => {
      root = hydrateRoot(container, screen);
    });
    expect(editLink()).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/viewer')),
    ).toBe(true);
    expect(
      mocks.getProgramOverview.mock.calls.every(
        ([, operations]) => operations === false,
      ),
    ).toBe(true);
  });

  it('학생의 옛 운영 query는 권한과 조회를 변경하지 않는다', async () => {
    mocks.hasStaffAccess = false;
    mocks.searchParams = new URLSearchParams('view=operations');
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await renderScreen();
    expect(editLink()).toBeNull();
    expect(
      fetchMock.mock.calls.every(
        ([url]) => !String(url).includes('view=operations'),
      ),
    ).toBe(true);
    expect(
      mocks.getProgramOverview.mock.calls.every(
        ([, operations]) => operations === false,
      ),
    ).toBe(true);
  });

  it('잘못된 저장값은 운영 전환으로 해석하지 않는다', async () => {
    sessionStorage.setItem(
      'oss-hub-program-operations-view:program-1',
      'operations',
    );
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await renderScreen();
    expect(editLink()).toBeNull();
    expect(container.querySelector('button[data-view-switch]')).toBeNull();
  });

  it('storage 쓰기가 막혀도 학생에게 운영 권한이 생기지 않는다', async () => {
    sessionStorage.setItem('oss-hub-program-operations-view:program-1', 'true');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await renderScreen();
    expect(editLink()).toBeNull();
    expect(editLink()).toBeNull();
    await renderScreen();
    expect(editLink()).toBeNull();
  });

  it('storage 읽기와 쓰기가 실패해도 학생 신분을 유지한다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await renderScreen();
    expect(editLink()).toBeNull();
    await renderScreen();
    expect(editLink()).toBeNull();
    expect(editLink()).toBeNull();
  });

  it('운영 사이드바 집계에는 개인의 서류 수 대신 완료한 팀 수를 표시한다', async () => {
    mocks.memberKind = 'STAFF';
    mocks.getProgramOverview.mockImplementation(
      async (
        _programId: string,
        operations: boolean,
      ): Promise<ProgramOverview> => ({
        programId: 'program-1',
        name: DETAIL.name,
        trackType: DETAIL.trackType,
        milestoneCount: 1,
        boardPostCount: 0,
        participantCount: 5,
        teamCount: 5,
        connectedRepositoryCount: 0,
        viewerRole: operations ? 'STAFF' : 'STUDENT',
        viewerDocumentsCompleted: operations ? null : 3,
        viewerDocumentsTotal: operations ? null : 4,
        fullySubmittedParticipantCount: operations ? 2 : null,
        remainingMilestones: [],
        requirements: [
          {
            milestoneId: 'milestone-1',
            title: '합성 단계',
            completed: operations ? 2 : 3,
            total: operations ? 5 : 4,
          },
        ],
      }),
    );
    await renderScreen();
    const sidebar = container.querySelector(
      '[data-slot="program-scope-sidebar"]',
    );
    expect(sidebar?.textContent).toContain('2/5팀');
    expect(sidebar?.textContent).not.toContain('3/5팀');
  });

  it('교직원·운영자 권한이 없는 학생은 참여 조회 실패에도 학생 본문을 유지한다', async () => {
    mocks.hasStaffAccess = false;
    await renderScreen();
    expect(container.textContent).not.toContain('팀 관리');
    expect(editLink()).toBeNull();
    expect(
      fetchMock.mock.calls.every(
        ([url]) => !String(url).includes('view=operations'),
      ),
    ).toBe(true);
  });
});
