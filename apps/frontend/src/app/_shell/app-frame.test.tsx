import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/components';

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSessionRole: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: mocks.usePathname }));
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
  { label: '홈', href: '/' },
  { label: '프로그램', href: '/programs' },
  { label: '아카이브', href: '/archive' },
];

function render(pathname: string) {
  mocks.usePathname.mockReturnValue(pathname);
  mocks.useSessionRole.mockReturnValue({
    status: 'assigned',
    role: 'STUDENT',
    roleRequestStatus: null,
    retry: () => {},
  });
  return renderToStaticMarkup(
    <AppFrame brand="OSS Hub" items={ITEMS} actions={<button>로그인</button>}>
      <p>본문</p>
    </AppFrame>,
  );
}

describe('AppFrame', () => {
  // 랜딩은 우주 여정 위 투명 헤더 → 흰 구간에서 흰 바로 바뀌는 동작을 이미 갖고 있다.
  // 사이드바를 얹으면 그 무대가 깨지므로 랜딩만 예외로 남긴다.
  it('랜딩(/)은 상단 헤더만 쓰고 사이드바를 넣지 않는다', () => {
    const html = render('/');

    expect(html).toContain('data-surface="inverted"');
    expect(html).toContain('fixed inset-x-0 top-0 z-40');
    expect(html).not.toContain('data-slot="app-sidebar"');
    expect(html).not.toContain('data-slot="product-shell"');
  });

  // 아직 회원이 아닌 사람에게 앱 내부 메뉴를 먼저 내밀지 않는다. 사이드바는 이미
  // 들어온 사람이 돌아다니는 도구다.
  it('가입·로그인(/signup)도 상단 헤더만 쓰고 사이드바를 넣지 않는다', () => {
    const html = render('/signup');

    expect(html).not.toContain('data-slot="app-sidebar"');
    expect(html).not.toContain('data-slot="product-shell"');
    // 랜딩만의 투명 오버레이 무대는 가져오지 않는다 — 평범한 흰 바다.
    expect(html).not.toContain('fixed inset-x-0 top-0 z-40');
  });

  it('로그인 뒤 화면(동의·온보딩)은 회원 동선이라 셸을 그대로 쓴다', () => {
    expect(render('/consent')).toContain('data-slot="product-shell"');
    expect(render('/onboarding/role')).toContain('data-slot="product-shell"');
  });

  it('그 외 라우트는 사이드바 + 상단바 셸을 쓴다', () => {
    const html = render('/dashboard');

    expect(html).toContain('data-slot="product-shell"');
    expect(html).toContain('data-slot="app-sidebar"');
    expect(html).toContain('data-slot="app-topbar"');
    expect(html).not.toContain('data-slot="nav-bar"');
  });

  it('두 갈래 모두 본문을 SkipLink 목적지(#main-content)로 감싼다', () => {
    expect(render('/')).toContain('id="main-content"');
    expect(render('/signup')).toContain('id="main-content"');
    expect(render('/dashboard')).toContain('id="main-content"');
  });

  it('셸 그리드 폭은 리터럴 px가 아니라 사이드바 토큰을 쓴다', () => {
    const html = render('/dashboard');

    expect(html).toContain(
      'grid-cols-[var(--sidebar-open-width)_minmax(0,1fr)]',
    );
  });

  it('서버 렌더는 항상 펼침이다 — localStorage는 브라우저에만 있어 hydration이 갈린다', () => {
    expect(render('/dashboard')).toContain('data-collapsed="false"');
  });
});

describe('readStoredCollapsed', () => {
  it("저장값이 'shut'일 때만 접힘이다", () => {
    expect(readStoredCollapsed('shut')).toBe(true);
    expect(readStoredCollapsed('open')).toBe(false);
    expect(readStoredCollapsed(null)).toBe(false);
    expect(readStoredCollapsed('true')).toBe(false);
  });

  it('저장 키는 시안과 같은 이름을 쓴다', () => {
    expect(SIDEBAR_STORAGE_KEY).toBe('oss-hub-sidebar');
  });
});
