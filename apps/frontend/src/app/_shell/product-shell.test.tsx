import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppRole } from './role';
import type { SessionStatus } from './use-session-role';

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useSessionRole: vi.fn(),
  getProgramOverview: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./use-session-role', () => ({ useSessionRole: mocks.useSessionRole }));
// 실제 fetch는 절대 안 일어난다(renderToStaticMarkup은 useEffect를 실행하지 않는다) —
// 그래도 모듈 로드 시점에 네트워크 계층에 닿지 않도록 대역으로 막아 둔다.
vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));

import { ProductShell, shouldLoadProgramOverview } from './product-shell';

function mockSession(
  overrides: {
    status?: SessionStatus;
    role?: AppRole | null;
    isProfileComplete?: boolean;
    memberKind?: 'STUDENT' | 'STAFF' | null;
    hasStaffAccess?: boolean;
    hasAdminAccess?: boolean;
  } = {},
) {
  mocks.useSessionRole.mockReturnValue({
    status: overrides.status ?? 'assigned',
    role: overrides.role ?? 'STUDENT',
    staffAccessRequestStatus: null,
    selectedRole: null,
    memberKind:
      overrides.memberKind ??
      (overrides.role === 'STAFF'
        ? 'STAFF'
        : overrides.role === null
          ? null
          : 'STUDENT'),
    hasStaffAccess: overrides.hasStaffAccess ?? overrides.role === 'STAFF',
    hasAdminAccess: overrides.hasAdminAccess ?? overrides.role === 'ADMIN',
    isProfileComplete: overrides.isProfileComplete ?? true,
    retry: () => {},
  });
}

function render(pathname: string) {
  mocks.usePathname.mockReturnValue(pathname);
  mocks.getProgramOverview.mockReturnValue(new Promise(() => {})); // 절대 안 풀림 — 로딩 상태 고정
  return renderToStaticMarkup(
    <ProductShell>
      <p>본문</p>
    </ProductShell>,
  );
}

describe('shouldLoadProgramOverview — 개요 fetch 발화 조건', () => {
  it('프로그램 상세이면서 회원일 때만 부른다', () => {
    expect(shouldLoadProgramOverview('prog-1', true)).toBe(true);
  });

  it('비회원은 부르지 않는다 — 개요 endpoint는 SessionGuard 뒤라 반드시 401이다', () => {
    expect(shouldLoadProgramOverview('prog-1', false)).toBe(false);
  });

  it('프로그램 상세가 아니면 회원이어도 부르지 않는다', () => {
    expect(shouldLoadProgramOverview(null, true)).toBe(false);
    expect(shouldLoadProgramOverview(null, false)).toBe(false);
  });
});

describe('ProductShell — 프로그램 상세 스코프 배선', () => {
  it('/programs 목록에서는 기존대로 AppSidebar(프로그램 메뉴 필터)를 그린다', () => {
    mockSession();
    const html = render('/programs');

    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).not.toContain('data-slot="program-scope-sidebar"');
    expect(html).toContain('프로그램 메뉴');
  });

  it('/programs/:id 하위에서는 AppSidebar 대신 ProgramScopeSidebar를 그린다', () => {
    mockSession();
    const html = render('/programs/prog-1');

    expect(html).toContain('data-slot="program-scope-sidebar"');
    expect(html).not.toContain('data-slot="app-sidebar"');
    expect(html).toContain('‹ 프로그램 목록');
    expect(html).toMatch(/href="\/programs"/);
    expect(html).toContain('프로그램 개요');
    expect(html).toContain('참여 팀');
    expect(html).toContain('게시판');
  });

  it('프로그램 상세의 하위 경로(teams 등)에서도 스코프 사이드바가 유지된다', () => {
    mockSession();
    const html = render('/programs/prog-1/teams');

    expect(html).toContain('data-slot="program-scope-sidebar"');
    expect(html).not.toContain('data-slot="app-sidebar"');
  });

  it('overview 응답이 오기 전에는 프로그램 id를 이름 자리표시자로 쓴다', () => {
    mockSession();
    const html = render('/programs/prog-1');

    expect(html).toContain('prog-1');
  });

  it('학생 회원은 "내 제출물"을 본다', () => {
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    const html = render('/programs/prog-1');

    expect(html).toContain('내 제출물');
    expect(html).not.toContain('서류 현황');
    // 신청 판정 창구는 교직원 전용이다.
    expect(html).not.toContain('신청자');
  });

  it('교직원 회원은 "서류 현황"과 신청 판정 입구(신청자)를 본다', () => {
    mockSession({ status: 'assigned', role: 'STAFF', isProfileComplete: true });
    const html = render('/programs/prog-1');

    expect(html).toContain('서류 현황');
    expect(html).not.toContain('내 제출물');
    expect(html).toContain('신청자');
    expect(html).toContain('/programs/prog-1/applicants');
    expect(html).toContain('‹ 프로그램 목록');
    expect(html).toMatch(/href="\/programs"/);
  });

  it('비회원·미배정·미완료 프로필은 참여 팀·신청자·서류 현황·게시판 없는 공개 개요만 본다(QA46)', () => {
    mockSession({ status: 'anonymous', role: null, isProfileComplete: false });
    const anonymous = render('/programs/prog-1');
    expect(anonymous).toContain('프로그램 개요');
    expect(anonymous).not.toContain('참여 팀');
    expect(anonymous).not.toContain('신청자');
    expect(anonymous).not.toContain('서류 현황');
    expect(anonymous).not.toContain('내 제출물');
    expect(anonymous).not.toContain('게시판');

    mockSession({ status: 'unassigned', role: null, isProfileComplete: false });
    const unassigned = render('/programs/prog-1');
    expect(unassigned).toContain('프로그램 개요');
    expect(unassigned).not.toContain('서류 현황');

    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: false,
    });
    const incompleteProfile = render('/programs/prog-1');
    expect(incompleteProfile).toContain('프로그램 개요');
    expect(incompleteProfile).not.toContain('서류 현황');
  });

  it('overview 로딩 중에는 팀 수·게시판 뱃지를 하드코딩 없이 비운다', () => {
    mockSession();
    const html = render('/programs/prog-1');

    expect(html).not.toContain('data-slot="program-scope-sidebar-count"');
  });

  it('회원 셸 그리드는 두 사이드바가 같은 사이드바 폭 토큰을 쓴다', () => {
    mockSession();
    const listHtml = render('/programs');
    const scopeHtml = render('/programs/prog-1');

    expect(listHtml).toContain(
      'grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]',
    );
    expect(scopeHtml).toContain(
      'grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]',
    );
  });

  it('본문을 SkipLink 목적지(#main-content)로 감싼다', () => {
    mockSession();
    expect(render('/programs/prog-1')).toContain('id="main-content"');
  });

  it('본문 칸만 세로 스크롤한다', () => {
    mockSession();
    const html = render('/programs/prog-1');
    expect(html).toMatch(/id="main-content"[^>]*overflow-y-auto/);
  });

  it('/dashboard 등 다른 섹션은 랭킹 시계를 그리지 않는다', () => {
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    const html = render('/dashboard');

    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).not.toContain('data-slot="program-countdown"');
    expect(html).not.toContain('다음 수집까지');
  });

  it('/dashboard 등 다른 섹션은 여전히 역할 메뉴 AppSidebar다(회귀)', () => {
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    const html = render('/dashboard');

    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).not.toContain('data-slot="program-scope-sidebar"');
  });
});
