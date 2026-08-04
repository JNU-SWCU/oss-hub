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
    isProfileComplete: boolean;
  } = {
    status: 'assigned',
    role: 'STUDENT',
    isProfileComplete: true,
  },
) {
  mocks.usePathname.mockReturnValue(pathname);
  mocks.useSessionRole.mockReturnValue({
    status: session.status,
    role: session.role,
    roleRequestStatus: null,
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

  it('랜딩(/)은 반전·fixed Nav이고 사이드바가 없다', () => {
    const html = render('/');
    expect(html).toContain('data-surface="inverted"');
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

  it('가입 완료 업무 화면은 상단 Nav + 사이드(프로그램 메뉴·내 상황)다', () => {
    const html = render('/dashboard', {
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    expect(html).toContain('data-slot="nav-bar"');
    expect(html).toContain('data-slot="product-shell"');
    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).toContain('프로그램 메뉴');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/my-repos"');
    expect(html).toContain('href="/programs?status=recruiting"');
  });

  it('비로그인 /programs 에도 프로그램 메뉴 사이드 패널이 있다', () => {
    const html = render('/programs', {
      status: 'anonymous',
      role: null,
      isProfileComplete: false,
    });
    expect(html).toContain('data-slot="nav-bar"');
    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).toContain('프로그램 메뉴');
    expect(html).toContain('href="/programs?status=ended"');
    expect(html).not.toContain('href="/dashboard"');
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
