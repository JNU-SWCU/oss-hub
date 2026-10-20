import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetail } from '@/features/programs/types';
import type { ProgramOverview } from '@/features/programs/program-overview-api';
import { ApiError } from '@/lib/api-client';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  hasStaffAccess: true,
  hasAdminAccess: false,
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
    memberKind: 'STUDENT',
    hasStaffAccess: mocks.hasStaffAccess,
    hasAdminAccess: mocks.hasAdminAccess,
    isProfileComplete: true,
  }),
}));
vi.mock('@/features/programs/student-application-api', () => ({
  getMyApplication: mocks.getMyApplication,
}));
vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/program-navigation-api', () => ({
  getProgramNavigationMilestones: async () => [
    { milestoneId: 'milestone-1', title: '합성 단계', submissionEnabled: true },
  ],
}));
vi.mock('@/features/programs/components/activity-graph-panel', () => ({
  ActivityGraphPanel: () => null,
}));

import { ProductShell } from '../../_shell/product-shell';
import { ProgramDetailScreen } from './program-detail-screen';

const DETAIL = {
  id: 'program-1',
  name: '합성 프로그램',
  organizer: '합성 기관',
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
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
  let root: Root;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mocks.hasStaffAccess = true;
    mocks.hasAdminAccess = false;
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
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const operations = url.endsWith('/viewer?view=operations');
      const role = operations
        ? mocks.hasAdminAccess
          ? 'ADMIN'
          : 'STAFF'
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
    vi.clearAllMocks();
  });

  async function renderScreen() {
    await act(async () =>
      root.render(
        <ProductShell>
          <ProgramDetailScreen programId="program-1" />
        </ProductShell>,
      ),
    );
  }

  function editLink(): Element | null {
    return container.querySelector('main a[href*="/edit?view=operations"]');
  }

  it.each(['STAFF', 'ADMIN'] as const)(
    '참여 조회 503 뒤 %s 메뉴와 본문을 함께 보여준다',
    async (role) => {
      mocks.hasStaffAccess = role === 'STAFF';
      mocks.hasAdminAccess = role === 'ADMIN';
      await renderScreen();
      expect(container.textContent).toContain('팀 관리');
      expect(editLink()).not.toBeNull();
      expect(mocks.getProgramOverview).toHaveBeenCalledWith('program-1', true);
    },
  );

  it('참여 확인 뒤 학생 화면을 기본으로 바꾸고 명시적 운영 화면과 왕복한다', async () => {
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    await renderScreen();
    expect(container.textContent).toContain('우리 팀');
    expect(editLink()).toBeNull();
    mocks.searchParams = new URLSearchParams('view=operations');
    await renderScreen();
    expect(container.textContent).toContain('팀 관리');
    expect(editLink()).not.toBeNull();
    mocks.searchParams = new URLSearchParams();
    await renderScreen();
    expect(container.textContent).toContain('우리 팀');
    expect(editLink()).toBeNull();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('운영 사이드바 집계에는 개인의 서류 수 대신 완료한 팀 수를 표시한다', async () => {
    mocks.getProgramOverview.mockImplementation(
      async (
        _programId: string,
        operations: boolean,
      ): Promise<ProgramOverview> => ({
        programId: 'program-1',
        name: DETAIL.name,
        trackType: DETAIL.trackType,
        lifecycle: 'PUBLISHED',
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
        milestoneDocuments: [
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
