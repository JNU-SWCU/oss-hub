import { notifyManager, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../test-support/render-with-query';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';

const queryClient = createTestQueryClient();
beforeEach(() => {
  queryClient.clear();
  notifyManager.setScheduler(queueMicrotask);
});
afterEach(() => {
  queryClient.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
});

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  return {
    usePathname: vi.fn(),
    useSearchParams: vi.fn(() => new URLSearchParams()),
    push,
    router: { push },
    useSessionRole: vi.fn(),
    getProgramOverview: vi.fn(),
    getProgramNavigationMilestones: vi.fn(),
    getProgramStatusCounts: vi.fn(),
    getRankingYears: vi.fn(),
    getMyApplication: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
  useRouter: () => mocks.router,
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
vi.mock('@/features/programs/catalog/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/catalog/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));
vi.mock('@/features/ranking/api', () => ({
  getRankingYears: mocks.getRankingYears,
}));
vi.mock('@/features/programs/catalog/api', () => ({
  getProgramStatusCounts: mocks.getProgramStatusCounts,
}));
vi.mock('@/features/programs/applications/student-application-api', () => ({
  getMyApplication: mocks.getMyApplication,
}));

import { AppFrame } from './app-frame';
import { bodyAttributeRemoved, nextFocus } from './drawer-test-signals';
import { useReportProgramName } from './program-name-report-context';
import { SHELL_MENU_SHEET_ID } from './shell-menu-sheet';
import { SIDEBAR_ASIDE_ID } from './sidebar-shell';

function NameReporter({
  programId,
  name,
}: {
  readonly programId: string;
  readonly name: string;
}) {
  const reportProgramName = useReportProgramName();
  useEffect(() => {
    reportProgramName(programId, name);
  }, [reportProgramName, programId, name]);
  return null;
}

interface SheetSession {
  readonly status:
    'loading' | 'anonymous' | 'unassigned' | 'assigned' | 'error';
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly memberKind: 'STUDENT' | 'STAFF' | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly isProfileComplete: boolean;
}

const STUDENT_ADMIN_SESSION: SheetSession = {
  status: 'assigned',
  role: 'ADMIN',
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: true,
  isProfileComplete: true,
};
const STUDENT_SESSION: SheetSession = {
  ...STUDENT_ADMIN_SESSION,
  role: 'STUDENT',
  hasAdminAccess: false,
};
const UNRESOLVED_COMPATIBILITY_ADMIN_SESSION: SheetSession = {
  ...STUDENT_ADMIN_SESSION,
  memberKind: null,
  hasStaffAccess: true,
};
const ANONYMOUS_SESSION: SheetSession = {
  status: 'anonymous',
  role: null,
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: false,
};

function mockSession(session: SheetSession): void {
  mocks.useSessionRole.mockReturnValue({
    ...session,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    retry: () => {},
  });
}

type MediaChangeListener = (event: MediaQueryListEvent) => void;

function fakeMatchMedia(listeners: Set<MediaChangeListener>, seen: string[]) {
  return (query: string): MediaQueryList => {
    seen.push(query);
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: MediaChangeListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: MediaChangeListener) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
}

describe('AppFrame 스코프 바와 메뉴 시트 — 통합', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    mocks.getProgramNavigationMilestones
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    mocks.getProgramStatusCounts
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    mocks.getMyApplication.mockReset().mockReturnValue(new Promise(() => {}));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.style.overflow = '';
    sessionStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function scopeBar(): HTMLElement | null {
    return container.querySelector('[data-slot="scope-bar"]');
  }

  function trigger(): HTMLButtonElement {
    const el = container.querySelector<HTMLButtonElement>(
      '[data-slot="scope-bar-menu-trigger"]',
    );
    if (el === null) throw new Error('스코프 바 메뉴 버튼을 찾지 못했습니다');
    return el;
  }

  function dialog(): HTMLElement | null {
    return document.querySelector('[role="dialog"]');
  }

  async function renderFrame(
    pathname: string,
    search = '',
    children: ReactNode = <p>본문</p>,
  ): Promise<void> {
    mocks.usePathname.mockReturnValue(pathname);
    mocks.useSearchParams.mockReturnValue(new URLSearchParams(search));
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AppFrame brand="OSS Hub">{children}</AppFrame>
        </QueryClientProvider>,
      );
    });
  }

  async function openSheet(): Promise<void> {
    await act(async () => {
      trigger().focus();
      trigger().click();
    });
  }

  it('reuses one consent GET for the real dialog and stays closed after accepting', async () => {
    const policyVersion = '2026-11-01';
    let consented = false;
    let consentGets = 0;
    const fetchMock = vi.fn<typeof fetch>(async (target, init) => {
      if (target === apiPath('consents/current')) {
        consentGets += 1;
        return new Response(
          JSON.stringify({
            policyVersion,
            requiredItems: [
              {
                key: 'GITHUB_ACTIVITY',
                label: 'GitHub 활동 수집·공개 범위',
                documentUrl: '/policies/github-activity',
              },
            ],
            consented,
            nextUrl: '/onboarding/role',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (target === apiPath('consents') && init?.method === 'POST') {
        consented = true;
        return new Response(
          JSON.stringify({
            policyVersion,
            consentedAt: '2026-11-01T00:00:00.000Z',
            nextUrl: '/onboarding/role',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new TypeError('Unexpected consent request');
    });
    vi.stubGlobal('fetch', fetchMock);
    mockSession(STUDENT_SESSION);
    const home = <p data-testid="home">학생 홈</p>;
    await renderFrame('/dashboard', '', home);

    expect(dialog()).not.toBeNull();
    const checkbox = document.body.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();
    expect(consentGets).toBe(1);
    expect(container.querySelector('[data-testid="home"]')).toBeNull();

    await act(async () => checkbox?.click());
    const submit = document.body.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(submit?.disabled).toBe(false);
    await act(async () => submit?.click());

    expect(consented).toBe(true);
    expect(consentGets).toBe(2);
    expect(dialog()).toBeNull();
    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    await act(async () => root.render(null));
    await renderFrame('/dashboard', '', home);
    expect(dialog()).toBeNull();
    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        ([target, init]) =>
          target === apiPath('consents') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('/dashboard는 닫힌 시트, 데스크톱 aside, 브랜드 제목이 있는 스코프 바를 렌더한다', async () => {
    mockSession(STUDENT_ADMIN_SESSION);
    await renderFrame('/dashboard');

    expect(dialog()).toBeNull();
    expect(
      container.querySelector('aside[data-slot="app-sidebar"]'),
    ).not.toBeNull();

    const bar = scopeBar();
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('data-scope')).toBe('dashboard');
    expect(
      bar?.querySelector('[data-slot="scope-bar-title"]')?.textContent,
    ).toBe('대시보드');

    const button = trigger();
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(SHELL_MENU_SHEET_ID);
  });

  it('목록 섹션(/programs, /ranking)에는 스코프 바가 없다 — 필터는 칩이 맡는다', async () => {
    mockSession(STUDENT_ADMIN_SESSION);
    await renderFrame('/programs');
    expect(scopeBar()).toBeNull();

    await renderFrame('/ranking');
    expect(scopeBar()).toBeNull();
  });

  it('미해결 호환 ADMIN(교직원+관리자)은 시트에 모든 그룹을 본다', async () => {
    mockSession(UNRESOLVED_COMPATIBILITY_ADMIN_SESSION);
    await renderFrame('/dashboard');

    await openSheet();

    const dlg = dialog();
    expect(dlg).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(
      dlg?.querySelector('[role="group"][aria-label="교직원"]'),
    ).not.toBeNull();
    expect(
      dlg?.querySelector('[role="group"][aria-label="관리자"]'),
    ).not.toBeNull();
    expect(dlg?.querySelector('[data-slot="app-sidebar-foot"]')).not.toBeNull();
  });

  it('admin-only 세션은 관리자 그룹만 시트에 표시한다', async () => {
    mockSession(STUDENT_ADMIN_SESSION);
    await renderFrame('/dashboard');

    await openSheet();

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
      ['사용자 목록', '/dashboard/users'],
      ['감사 로그', '/dashboard/audit-logs'],
      ['시스템 상태', '/dashboard/system-status'],
    ]) {
      const link = adminGroup?.querySelector<HTMLAnchorElement>(
        `a[href="${href}"]`,
      );
      expect(link, href).not.toBeNull();
      expect(link?.textContent, href).toContain(label);
    }
  });

  it('열려 있는 동안 상단 nav 항목 목록에는 역할 메뉴가 섞이지 않는다', async () => {
    mockSession(STUDENT_ADMIN_SESSION);
    await renderFrame('/dashboard');
    await openSheet();

    const navItemsList = container.querySelector('[data-slot="nav-bar-items"]');
    expect(
      navItemsList?.querySelector('a[href="/dashboard/users"]'),
    ).toBeNull();
    expect(
      navItemsList?.querySelector('a[href="/dashboard/audit-logs"]'),
    ).toBeNull();
    expect(
      navItemsList?.querySelector('a[href="/dashboard/system-status"]'),
    ).toBeNull();
  });

  it('프로그램 상세 경로에서는 스코프 바에 뒤로 링크가 있고 시트에 프로그램 메뉴가 뜬다', async () => {
    mockSession(STUDENT_SESSION);
    mocks.getProgramOverview.mockReturnValue(new Promise(() => {}));
    await renderFrame('/programs/prog-1');

    const bar = scopeBar();
    expect(bar?.getAttribute('data-scope')).toBe('program');
    expect(
      bar
        ?.querySelector('[data-slot="sidebar-shell-back"]')
        ?.getAttribute('href'),
    ).toBe('/programs');
    expect(trigger().textContent).toContain('프로그램 개요');

    await openSheet();

    const dlg = dialog();
    expect(dlg).not.toBeNull();
    expect(dlg?.textContent).toContain('프로그램 개요');
    expect(dlg?.querySelector('a[href="/programs/prog-1"]')).not.toBeNull();
    expect(
      dlg?.querySelector('[data-slot="program-scope-sidebar-foot"]'),
    ).not.toBeNull();
  });

  it('비회원도 프로그램 상세에서 스코프 바를 보고, 라우트가 보고한 이름이 ID 대신 쓰인다', async () => {
    mockSession(ANONYMOUS_SESSION);
    await renderFrame(
      '/programs/prog-1',
      '',
      <NameReporter programId="prog-1" name="2026-2 오픈소스 SW 프로젝트" />,
    );

    const bar = scopeBar();
    expect(bar).not.toBeNull();
    expect(bar?.querySelector('[data-slot$="-skeleton"]')).toBeNull();
    expect(
      bar?.querySelector('[data-slot="sidebar-shell-scope-title"]')
        ?.textContent,
    ).toBe('2026-2 오픈소스 SW 프로젝트');
    expect(bar?.textContent).not.toContain('prog-1');

    const asideTitle = document
      .getElementById(SIDEBAR_ASIDE_ID)
      ?.querySelector('[data-slot="sidebar-shell-scope-title"]');
    expect(asideTitle?.textContent).toBe('prog-1');

    await openSheet();
    const dlg = dialog();
    const titleId = dlg?.getAttribute('aria-labelledby') ?? '';
    expect(document.getElementById(titleId)?.textContent).toBe(
      '2026-2 오픈소스 SW 프로젝트',
    );
  });

  it('다른 프로그램의 보고는 쓰지 않는다 — ID로 돌아간다', async () => {
    mockSession(ANONYMOUS_SESSION);
    await renderFrame(
      '/programs/prog-2',
      '',
      <NameReporter programId="prog-1" name="다른 프로그램" />,
    );

    expect(
      scopeBar()?.querySelector('[data-slot="sidebar-shell-scope-title"]')
        ?.textContent,
    ).toBe('prog-2');
  });

  it('Escape를 누르면 닫히고 초점이 스코프 바 버튼으로 돌아온다', async () => {
    mockSession(STUDENT_ADMIN_SESSION);
    await renderFrame('/dashboard');
    await openSheet();
    expect(dialog()).not.toBeNull();
    const refocused = nextFocus(trigger());

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
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await act(() => refocused);
    expect(document.activeElement).toBe(trigger());
  });

  it('경로가 바뀌면(라우트 전환) 시트가 자동으로 닫힌다', async () => {
    mockSession(STUDENT_ADMIN_SESSION);
    await renderFrame('/dashboard');
    await openSheet();
    expect(dialog()).not.toBeNull();

    await renderFrame('/dashboard/users');

    expect(dialog()).toBeNull();
  });

  it('같은 서류 경로에서 선택 마일스톤 쿼리만 바뀌어도 시트가 닫힌다', async () => {
    mockSession(STUDENT_SESSION);
    mocks.getProgramOverview.mockReturnValue(new Promise(() => {}));
    await renderFrame('/programs/prog-1/documents');
    await openSheet();
    expect(dialog()).not.toBeNull();

    await renderFrame(
      '/programs/prog-1/documents',
      'milestoneId=milestone-mid',
    );

    expect(dialog()).toBeNull();
  });

  it('프로그램 개요에서 화면을 전환하면 주소가 그대로여도 시트가 닫힌다', async () => {
    mockSession({ ...STUDENT_SESSION, hasStaffAccess: true });
    mocks.getMyApplication.mockResolvedValue({ status: 'APPROVED' });
    mocks.getProgramOverview.mockReturnValue(new Promise(() => {}));
    await renderFrame('/programs/prog-1');
    await openSheet();
    const viewSwitch = dialog()?.querySelector('button[data-view-switch]');
    if (!(viewSwitch instanceof HTMLButtonElement))
      throw new Error('화면 전환 버튼을 찾지 못했습니다');

    await act(async () => viewSwitch.click());

    expect(mocks.push).toHaveBeenCalledWith('/programs/prog-1');
    expect(dialog()).toBeNull();
  });

  it('뷰포트가 데스크톱(shell 폭)으로 넘어가면 시트가 닫히고 스크롤 잠금이 풀린다', async () => {
    const listeners = new Set<MediaChangeListener>();
    const queries: string[] = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: fakeMatchMedia(listeners, queries),
    });
    mockSession(STUDENT_ADMIN_SESSION);
    await renderFrame('/dashboard');
    expect(listeners.size).toBe(0);

    await openSheet();
    expect(dialog()).not.toBeNull();
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
    expect(queries).toContain('(min-width: 900px)');
    expect(listeners.size).toBe(1);

    const unlocked = bodyAttributeRemoved('data-scroll-locked');
    await act(async () => {
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(dialog()).toBeNull();
    await act(() => unlocked);
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
    expect(listeners.size).toBe(0);
  });
});

const OVERLAY_WRAPPER = '.fixed.inset-x-0.top-0.z-40';

describe('AppFrame 랜딩(/) 내비 — 처음부터 흰 바', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.getProgramNavigationMilestones
      .mockReset()
      .mockReturnValue(new Promise(() => {}));
    mockSession(ANONYMOUS_SESSION);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function nav(): HTMLElement {
    const el = container.querySelector<HTMLElement>('nav[data-slot="nav-bar"]');
    if (el === null) throw new Error('상단 nav를 찾지 못했습니다');
    return el;
  }

  async function renderAt(pathname: string): Promise<void> {
    mocks.usePathname.mockReturnValue(pathname);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AppFrame brand="OSS Hub">
            <section id="landing-hero">히어로</section>
          </AppFrame>
        </QueryClientProvider>,
      );
    });
  }

  it('히어로가 있어도 랜딩 내비는 흰 기본 표면이고 fixed로 히어로 위에 선다', async () => {
    await renderAt('/');

    const bar = nav();
    expect(bar.getAttribute('data-surface')).toBeNull();
    expect(bar.classList.contains('bg-background')).toBe(true);
    expect(bar.classList.contains('bg-transparent')).toBe(false);
    expect(container.querySelector(OVERLAY_WRAPPER)?.contains(bar)).toBe(true);
  });

  it('/consent 로 가면 같은 흰 바이고 fixed가 아니다', async () => {
    await renderAt('/consent');

    expect(nav().getAttribute('data-surface')).toBeNull();
    expect(nav().classList.contains('bg-background')).toBe(true);
    expect(container.querySelector(OVERLAY_WRAPPER)).toBeNull();
  });
});
