import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/components';

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useSessionRole: vi.fn(),
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

import { AppFrame } from './app-frame';
import { readStoredCollapsed, SIDEBAR_STORAGE_KEY } from './product-shell';

const ITEMS: NavItem[] = [
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];

function render(
  pathname: string,
  session: {
    status: 'loading' | 'anonymous' | 'unassigned' | 'assigned' | 'error';
    role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
    memberKind?: 'STUDENT' | 'STAFF' | null;
    hasStaffAccess?: boolean;
    hasAdminAccess?: boolean;
    isProfileComplete: boolean;
  } = {
    status: 'assigned',
    role: 'STUDENT',
    isProfileComplete: true,
  },
): string {
  mocks.usePathname.mockReturnValue(pathname);
  mocks.useSessionRole.mockReturnValue({
    status: session.status,
    role: session.role,
    memberKind:
      session.memberKind === undefined
        ? session.role === 'STUDENT' || session.role === 'STAFF'
          ? session.role
          : null
        : session.memberKind,
    hasStaffAccess:
      session.hasStaffAccess === undefined
        ? session.role === 'STAFF'
        : session.hasStaffAccess,
    hasAdminAccess:
      session.hasAdminAccess === undefined
        ? session.role === 'ADMIN'
        : session.hasAdminAccess,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: session.isProfileComplete,
    retry: () => {},
  });
  return renderToStaticMarkup(
    <AppFrame brand="OSS Hub" items={ITEMS} actions={<button>로그인</button>}>
      <p>본문</p>
    </AppFrame>,
  );
}

describe('AppFrame', () => {
  it('모든 라우트에 공통 상단 NavBar가 있다', () => {
    for (const path of ['/', '/signup', '/dashboard', '/programs']) {
      expect(render(path), path).toContain('data-slot="nav-bar"');
    }
  });

  it('랜딩(/)은 고정 흰 바 Nav이고 사이드바가 없다', () => {
    const html = render('/');
    expect(html).not.toContain('data-surface="inverted"');
    expect(html).toContain('fixed inset-x-0 top-0 z-40');
    expect(html).not.toContain('data-slot="app-sidebar"');
  });

  it('가입 화면에는 사이드바를 달지 않는다', () => {
    for (const path of ['/signup', '/consent', '/onboarding/role']) {
      const html = render(path);
      expect(html, path).not.toContain('data-slot="app-sidebar"');
      expect(html, path).toContain('data-slot="nav-bar"');
    }
  });

  it('가입 완료 시 상단에 대시보드가 붙고 /dashboard 좌측은 역할 메뉴만', () => {
    const html = render('/dashboard', {
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    expect(html).toContain('data-slot="nav-bar"');
    expect(html).toContain('>대시보드<');
    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).toContain('href="/my-repos"');
    // 컨텍스트형: 대시보드 섹션에 프로그램 필터 없음
    expect(html).not.toContain('모집중');
  });

  it('비로그인 /programs 는 프로그램 메뉴만 좌측에 있다', () => {
    const html = render('/programs', {
      status: 'anonymous',
      role: null,
      isProfileComplete: false,
    });
    expect(html).toContain('프로그램 메뉴');
    expect(html).not.toContain('data-slot="app-sidebar-depth-children"');
    expect(html).toContain('href="/programs?status=ended"');
    expect(html).not.toContain('>대시보드<');
  });

  it('/programs 에서 로그인해도 좌측 사이드바에는 역할 메뉴를 섞지 않는다', () => {
    const html = render('/programs', {
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    expect(html).toContain('프로그램 메뉴');
    expect(html).toContain('>대시보드<'); // top nav
    // 상단 nav에는 역할 메뉴가 900px 미만 전용으로 섞이지만(QA54), 좌측
    // 사이드바(현재 섹션 컨텍스트)에는 여전히 섞지 않는다.
    const sidebar =
      html.match(/data-slot="app-sidebar"[\s\S]*?<\/aside>/)?.[0] ?? '';
    expect(sidebar).not.toContain('내 저장소');
  });

  // 드로어 도입(feat/sidebar-drawer-below-900) 이후: 900px 미만에서 관리자·역할
  // 메뉴는 상단 nav가 아니라 햄버거 드로어(SidebarDrawer)로 닿는다. 상단 nav의
  // 항목 목록 자체는 role 무관하게 `items`(공개 메뉴) + 로그인 시 대시보드뿐이다.
  it('ADMIN 세션이어도 상단 nav 항목 목록에 역할 전용 메뉴(관리자 하위)를 섞지 않는다', () => {
    const html = render('/dashboard', {
      status: 'assigned',
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
      isProfileComplete: true,
    });
    const navItemsList =
      html.match(/data-slot="nav-bar-items"[\s\S]*?<\/ul>/)?.[0] ?? '';
    for (const href of [
      '/admin/access',
      '/admin/audit-log',
      '/admin/system-status',
    ]) {
      expect(navItemsList, href).not.toContain(`href="${href}"`);
    }
  });

  it('900px 미만 사이드바 드로어 토글은 세션과 무관하게 렌더되고 min-[900px]:hidden이다', () => {
    const html = render('/dashboard');
    const trigger = html.match(
      /<button[^>]*data-slot="nav-bar-sidebar-drawer-trigger"[^>]*>/,
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain('min-[900px]:hidden');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-controls="app-sidebar-drawer"');
  });

  it('상단 내비에서 역할 메뉴가 기존 항목과 href가 겹치면 하나만 남는다', () => {
    const html = render('/dashboard', {
      status: 'assigned',
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
      isProfileComplete: true,
    });
    // 대시보드(공통) 항목만 있어야 한다 — role 메뉴는 더 이상 상단 nav에 섞이지 않는다.
    const navItemsList =
      html.match(/data-slot="nav-bar-items"[\s\S]*?<\/ul>/)?.[0] ?? '';
    const dashboardOccurrences =
      navItemsList.split('href="/dashboard"').length - 1;
    expect(dashboardOccurrences).toBe(1);
  });

  it('본문을 SkipLink 목적지(#main-content)로 감싼다', () => {
    expect(render('/')).toContain('id="main-content"');
    expect(render('/dashboard')).toContain('id="main-content"');
  });

  it('회원 셸 그리드는 사이드바 토큰을 쓴다', () => {
    const html = render('/dashboard');
    expect(html).toContain(
      'grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]',
    );
  });

  it('미해결 호환 세션도 정상 인증 셸과 본문을 렌더한다', () => {
    // Given
    const session = {
      status: 'assigned' as const,
      role: 'ADMIN' as const,
      memberKind: null,
      hasStaffAccess: true,
      hasAdminAccess: true,
      isProfileComplete: true,
    };

    // When
    const html = render('/dashboard', session);

    // Then
    expect(html).toContain('data-slot="nav-bar"');
    expect(html).toContain('>대시보드<');
    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).toContain('<p>본문</p>');
  });

  it('회원 셸은 뷰포트를 고정하고 본문만 스크롤한다', () => {
    const html = render('/dashboard');
    expect(html).toContain('flex h-dvh flex-col overflow-hidden');
    expect(html).toContain('overflow-y-auto');
  });
});

describe('readStoredCollapsed', () => {
  it("저장값이 'shut'일 때만 접힘이다", () => {
    expect(readStoredCollapsed('shut')).toBe(true);
    expect(readStoredCollapsed('open')).toBe(false);
    expect(readStoredCollapsed(null)).toBe(false);
  });

  it('저장 키는 시안과 같은 이름을 쓴다', () => {
    expect(SIDEBAR_STORAGE_KEY).toBe('oss-hub-sidebar');
  });
});
