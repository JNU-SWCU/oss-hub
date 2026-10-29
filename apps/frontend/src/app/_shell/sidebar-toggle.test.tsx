import { act, useEffect } from 'react';
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
  loadArchiveYears: vi.fn(),
  getRankingYears: vi.fn(),
  getProgramStatusCounts: vi.fn(),
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
vi.mock('@/features/archive/api', () => ({
  loadArchiveYears: mocks.loadArchiveYears,
}));
vi.mock('@/features/ranking/api', () => ({
  getRankingYears: mocks.getRankingYears,
}));
vi.mock('@/features/programs/catalog/api', () => ({
  getProgramStatusCounts: mocks.getProgramStatusCounts,
}));

import { AppFrame } from './app-frame';
import { useRankingCycle } from './ranking-cycle-context';
import { SIDEBAR_STORAGE_KEY } from './sidebar-collapsed';
import { SIDEBAR_ASIDE_ID } from './sidebar-shell';

const ITEMS: NavItem[] = [
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];

function mockSession(status: 'anonymous' | 'assigned'): void {
  mocks.useSessionRole.mockReturnValue({
    status,
    role: status === 'assigned' ? 'STUDENT' : null,
    memberKind: status === 'assigned' ? 'STUDENT' : null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: status === 'assigned',
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    retry: () => {},
  });
}

function RankingPage() {
  const { setNextCycleAt } = useRankingCycle();
  useEffect(() => {
    setNextCycleAt('2026-08-21T00:00:00.000Z');
  }, [setNextCycleAt]);
  return <p>본문</p>;
}

describe('상단바 사이드바 토글 — AppFrame 통합', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.loadArchiveYears.mockReset().mockResolvedValue([2026]);
    mocks.getRankingYears.mockReset().mockResolvedValue([2026]);
    mocks.getProgramStatusCounts.mockReset().mockResolvedValue({});
    mockSession('anonymous');
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

  function desktopToggle(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(
      '[data-slot="nav-bar-sidebar-toggle"]',
    );
  }

  function drawerTrigger(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(
      '[data-slot="nav-bar-sidebar-drawer-trigger"]',
    );
  }

  function productShell(): HTMLElement | null {
    return container.querySelector('[data-slot="product-shell"]');
  }

  async function renderFrame(
    pathname: string,
    children: React.ReactNode = <p>본문</p>,
  ): Promise<void> {
    mocks.usePathname.mockReturnValue(pathname);
    await act(async () => {
      root.render(
        <AppFrame brand="OSS Hub" items={ITEMS}>
          {children}
        </AppFrame>,
      );
    });
  }

  it('사이드바가 있는 경로에서만 데스크톱 토글과 드로어 트리거를 함께 그린다', async () => {
    await renderFrame('/archive');
    const toggle = desktopToggle();
    const trigger = drawerTrigger();
    expect(toggle).not.toBeNull();
    expect(trigger).not.toBeNull();
    expect(toggle?.getAttribute('data-breakpoint-visibility')).toBe('desktop');
    expect(trigger?.getAttribute('data-breakpoint-visibility')).toBe('mobile');

    const nav = container.querySelector('nav[data-slot="nav-bar"]');
    expect(nav?.firstElementChild).toBe(toggle);
    expect(toggle?.nextElementSibling).toBe(trigger);
    expect(trigger?.nextElementSibling?.getAttribute('data-slot')).toBe(
      'nav-bar-brand',
    );
  });

  it('사이드바가 없는 경로(비회원 /dashboard, 가입 화면)에는 토글을 그리지 않는다', async () => {
    await renderFrame('/dashboard');
    expect(productShell()).toBeNull();
    expect(desktopToggle()).toBeNull();
    expect(drawerTrigger()).toBeNull();

    await renderFrame('/signup');
    expect(desktopToggle()).toBeNull();
    expect(drawerTrigger()).toBeNull();
  });

  it('데스크톱 토글은 셸의 data-collapsed를 뒤집고 aside를 가리키며 쿠키를 쓴다', async () => {
    await renderFrame('/archive');
    const toggle = desktopToggle();
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('사이드바 접기');
    expect(toggle?.getAttribute('aria-controls')).toBe(SIDEBAR_ASIDE_ID);
    expect(document.getElementById(SIDEBAR_ASIDE_ID)?.tagName).toBe('ASIDE');
    expect(productShell()?.getAttribute('data-collapsed')).toBe('false');

    await act(async () => {
      toggle?.click();
    });

    expect(productShell()?.getAttribute('data-collapsed')).toBe('true');
    expect(
      document.getElementById(SIDEBAR_ASIDE_ID)?.getAttribute('data-collapsed'),
    ).toBe('true');
    expect(desktopToggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(desktopToggle()?.getAttribute('aria-label')).toBe('사이드바 펼치기');
    expect(document.cookie).toContain(`${SIDEBAR_STORAGE_KEY}=shut`);

    await act(async () => {
      desktopToggle()?.click();
    });

    expect(productShell()?.getAttribute('data-collapsed')).toBe('false');
    expect(document.cookie).toContain(`${SIDEBAR_STORAGE_KEY}=open`);
  });

  describe('패널 애니메이션 단계', () => {
    const root = document.documentElement;

    beforeEach(() => {
      root.style.setProperty('--sidebar-collapse-duration', '140ms');
      root.style.setProperty('--sidebar-expand-duration', '200ms');
    });

    afterEach(() => {
      root.style.removeProperty('--sidebar-collapse-duration');
      root.style.removeProperty('--sidebar-expand-duration');
      vi.useRealTimers();
    });

    function panel(): HTMLElement | null {
      return container.querySelector('[data-slot="sidebar-shell-panel"]');
    }

    function phase(): string | null | undefined {
      return productShell()?.getAttribute('data-sidebar-phase');
    }

    function railCollapsed(): string | null | undefined {
      return document
        .getElementById(SIDEBAR_ASIDE_ID)
        ?.getAttribute('data-collapsed');
    }

    function nextFrame(): Promise<void> {
      return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    it('접기는 패널을 먼저 숨기고 transitionend 뒤에야 레일로 좁힌다', async () => {
      await renderFrame('/archive');
      await act(async () => desktopToggle()?.click());

      expect(productShell()?.getAttribute('data-collapsed')).toBe('true');
      expect(phase()).toBe('collapsing');
      expect(panel()?.getAttribute('data-phase')).toBe('collapsing');
      expect(railCollapsed()).toBe('false');

      await act(async () => {
        panel()?.dispatchEvent(new Event('transitionend', { bubbles: true }));
      });

      expect(phase()).toBe('collapsed');
      expect(railCollapsed()).toBe('true');
    });

    it('transitionend가 오지 않아도 접기 시간 뒤 레일로 끝난다', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await renderFrame('/archive');
      await act(async () => desktopToggle()?.click());
      expect(phase()).toBe('collapsing');

      await act(async () => {
        vi.advanceTimersByTime(140);
      });

      expect(phase()).toBe('collapsed');
      expect(railCollapsed()).toBe('true');
    });

    it('펼치기는 그리드를 즉시 넓히고 다음 프레임에 패널을 드러낸다', async () => {
      await renderFrame('/archive');
      await act(async () => desktopToggle()?.click());
      await act(async () => {
        panel()?.dispatchEvent(new Event('transitionend', { bubbles: true }));
      });
      expect(phase()).toBe('collapsed');

      await act(async () => desktopToggle()?.click());
      expect(productShell()?.getAttribute('data-collapsed')).toBe('false');
      expect(phase()).toBe('expanding');
      expect(railCollapsed()).toBe('false');

      await act(async () => {
        await nextFrame();
        await nextFrame();
      });

      expect(phase()).toBe('open');
      expect(panel()?.getAttribute('data-phase')).toBe('open');
    });
  });

  it('드로어 트리거는 드로어를 열고 aria-expanded를 반영한다', async () => {
    await renderFrame('/archive');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(drawerTrigger()?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      drawerTrigger()?.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(drawerTrigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(productShell()?.getAttribute('data-collapsed')).toBe('false');
  });

  it('aside 안에는 토글이 없다', async () => {
    await renderFrame('/archive');
    const aside = document.getElementById(SIDEBAR_ASIDE_ID);
    expect(aside).not.toBeNull();
    expect(aside?.querySelector('button')).toBeNull();
  });

  it('랭킹 카운트다운은 한 바인딩으로 aside와 드로어 양쪽에 그려진다', async () => {
    await renderFrame('/ranking');
    expect(
      document
        .getElementById(SIDEBAR_ASIDE_ID)
        ?.querySelector('[data-slot="sidebar-bottom-skeleton"]'),
    ).not.toBeNull();

    await renderFrame('/ranking', <RankingPage />);
    const aside = document.getElementById(SIDEBAR_ASIDE_ID);
    expect(aside?.querySelector('[data-slot="sidebar-bottom-skeleton"]')).toBeNull();
    expect(aside?.querySelector('[data-slot="program-countdown"]')).not.toBeNull();
    expect(aside?.textContent).toContain('다음 수집');

    await act(async () => {
      drawerTrigger()?.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('[data-slot="program-countdown"]')).not.toBeNull();
    expect(
      dialog?.querySelector('[data-slot="sidebar-shell"][data-variant="drawer"]'),
    ).not.toBeNull();
  });
});
