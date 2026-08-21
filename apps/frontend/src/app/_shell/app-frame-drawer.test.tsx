// @vitest-environment happy-dom

// 900px 미만 사이드바 드로어의 통합 동작 — 세션·라우트에 따라 드로어 "안"에
// 실제로 어떤 그룹/항목이 뜨는지는 `renderToStaticMarkup`(app-frame.test.tsx)으로는
// 볼 수 없다. `SidebarDrawer`는 `open`일 때만 콘텐츠를 그리는데, 열림은
// `ShellNav`(햄버거)와 `ProductShell`(드로어) 사이를 context로 오가는 실제
// 클릭 상호작용이라 정적 렌더에는 애초에 나타나지 않는다. 여기서는 `AppFrame`
// 전체를 실제 DOM에 올려 햄버거를 눌러 본다.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/components';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

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
vi.mock('@/features/programs/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));

import { AppFrame } from './app-frame';

const ITEMS: NavItem[] = [
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];

function mockSession(session: {
  status: 'loading' | 'anonymous' | 'unassigned' | 'assigned' | 'error';
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  isProfileComplete: boolean;
}) {
  mocks.useSessionRole.mockReturnValue({
    status: session.status,
    role: session.role,
    roleRequestStatus: null,
    isProfileComplete: session.isProfileComplete,
    retry: () => {},
  });
}

describe('AppFrame 사이드바 드로어 — 통합', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.style.overflow = '';
    vi.clearAllMocks();
  });

  function trigger(): HTMLButtonElement {
    const el = container.querySelector<HTMLButtonElement>(
      '[data-slot="nav-bar-sidebar-drawer-trigger"]',
    );
    if (el === null) throw new Error('드로어 토글을 찾지 못했습니다');
    return el;
  }

  function dialog(): HTMLElement | null {
    return container.querySelector('[role="dialog"]');
  }

  async function renderFrame(pathname: string) {
    mocks.usePathname.mockReturnValue(pathname);
    await act(async () => {
      root.render(
        <AppFrame brand="OSS Hub" items={ITEMS}>
          <p>본문</p>
        </AppFrame>,
      );
    });
  }

  async function openDrawer() {
    // 실제 클릭은 버튼에 포커스를 남긴다(브라우저 기본 동작) — happy-dom의
    // 합성 `.click()`은 그걸 흉내 내지 않으므로 직접 포커스를 맞춰 준다.
    // 키보드로 여는 사용자는 애초에 이 버튼에 포커스가 있어 같은 상태가 된다.
    await act(async () => {
      trigger().focus();
      trigger().click();
    });
  }

  it('ADMIN 세션, /dashboard: 닫혀 있을 때는 드로어가 없고 aside가 있다', async () => {
    mockSession({ status: 'assigned', role: 'ADMIN', isProfileComplete: true });
    await renderFrame('/dashboard');

    expect(dialog()).toBeNull();
    expect(
      container.querySelector('aside[data-slot="app-sidebar"]'),
    ).not.toBeNull();
  });

  it('admin-only 세션은 관리자 그룹만 드로어에 표시한다', async () => {
    mockSession({ status: 'assigned', role: 'ADMIN', isProfileComplete: true });
    await renderFrame('/dashboard');

    await openDrawer();

    const dlg = dialog();
    expect(dlg).not.toBeNull();
    expect(dlg?.getAttribute('aria-modal')).toBe('true');

    const staffGroup = dlg?.querySelector(
      '[role="group"][aria-label="교직원"]',
    );
    const adminGroup = dlg?.querySelector(
      '[role="group"][aria-label="관리자"]',
    );
    expect(staffGroup).toBeNull();
    expect(adminGroup).not.toBeNull();

    for (const [label, href] of [
      ['사용자 목록', '/admin/access'],
      ['감사 로그', '/admin/audit-log'],
      ['시스템 상태', '/admin/system-status'],
    ]) {
      const link = adminGroup?.querySelector<HTMLAnchorElement>(
        `a[href="${href}"]`,
      );
      expect(link, href).not.toBeNull();
      expect(link?.textContent, href).toContain(label);
    }
  });

  it('열려 있는 동안 상단 nav 항목 목록에는 역할 메뉴가 섞이지 않는다', async () => {
    mockSession({ status: 'assigned', role: 'ADMIN', isProfileComplete: true });
    await renderFrame('/dashboard');
    await openDrawer();

    const navItemsList = container.querySelector('[data-slot="nav-bar-items"]');
    expect(navItemsList?.querySelector('a[href="/admin/access"]')).toBeNull();
    expect(
      navItemsList?.querySelector('a[href="/admin/audit-log"]'),
    ).toBeNull();
    expect(
      navItemsList?.querySelector('a[href="/admin/system-status"]'),
    ).toBeNull();
  });

  it('프로그램 상세 경로에서는 ProgramScopeSidebar 그룹이 드로어에 뜬다', async () => {
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    mocks.getProgramOverview.mockReturnValue(new Promise(() => {})); // 로딩 고정
    await renderFrame('/programs/prog-1');

    await openDrawer();

    const dlg = dialog();
    expect(dlg).not.toBeNull();
    expect(dlg?.textContent).toContain('프로그램 개요');
    expect(dlg?.querySelector('a[href="/programs/prog-1"]')).not.toBeNull();
  });

  it('Escape를 누르면 닫히고 초점이 햄버거로 돌아온다', async () => {
    mockSession({ status: 'assigned', role: 'ADMIN', isProfileComplete: true });
    await renderFrame('/dashboard');
    await openDrawer();
    expect(dialog()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('경로가 바뀌면(라우트 전환) 드로어가 자동으로 닫힌다', async () => {
    mockSession({ status: 'assigned', role: 'ADMIN', isProfileComplete: true });
    await renderFrame('/dashboard');
    await openDrawer();
    expect(dialog()).not.toBeNull();

    await renderFrame('/programs');

    expect(dialog()).toBeNull();
  });
});
