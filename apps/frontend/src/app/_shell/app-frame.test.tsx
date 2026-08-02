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

  // 회원가입의 정의가 바뀌면서 이 판정이 뒤집혔다 — GitHub 연결만으로는 가입이
  // 아니고 프로필 입력까지 마쳐야 회원이다. 그래서 가입 중 화면은 회원 동선이
  // 아니고, 업무 사이드바를 달지 않는다. 실제로 그 사이드바는 가입 중인 학생이
  // 프로그램 목록으로 빠져나가는 통로였다.
  it.each(['/consent', '/onboarding/role', '/onboarding/profile'])(
    '가입을 마치기 전 화면(%s)에는 업무 사이드바를 달지 않는다',
    (path) => {
      const html = render(path);

      expect(html).not.toContain('data-slot="product-shell"');
      expect(html).not.toContain('data-slot="app-sidebar"');
      expect(html).toContain('data-slot="nav-bar"');
    },
  );

  // 교직원이 프로필까지 마치고 승인을 기다리는 화면이다. 정의상 이미 회원이고
  // 역할만 아직 붙지 않았으므로 업무 셸 그대로다.
  it('승인 대기(/onboarding/pending)는 이미 회원이므로 업무 셸을 쓴다', () => {
    expect(render('/onboarding/pending')).toContain(
      'data-slot="product-shell"',
    );
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
