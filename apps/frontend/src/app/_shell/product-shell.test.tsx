import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppRole } from './role';
import type { SessionStatus } from './use-session-role';

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useSessionRole: vi.fn(),
  getProgramOverview: vi.fn(),
  getProgramNavigationMilestones: vi.fn(),
  getMyApplication: vi.fn(),
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
vi.mock('./program-operations-view', () => ({
  useProgramOperationsView: () => false,
}));

vi.mock('@/features/programs/catalog/program-overview-api', () => ({
  getProgramOverview: mocks.getProgramOverview,
}));
vi.mock('@/features/programs/catalog/program-navigation-api', () => ({
  getProgramNavigationMilestones: mocks.getProgramNavigationMilestones,
}));
vi.mock('@/features/programs/applications/student-application-api', () => ({
  getMyApplication: mocks.getMyApplication,
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

function mainContentClasses(html: string): readonly string[] {
  const match = /id="main-content"[^>]*class="([^"]*)"/.exec(html);
  if (match === null) throw new Error('#main-content missing');
  return (match[1] ?? '').split(' ');
}

function render(pathname: string) {
  mocks.usePathname.mockReturnValue(pathname);
  mocks.getProgramOverview.mockReturnValue(new Promise(() => {}));
  mocks.getProgramNavigationMilestones.mockReturnValue(new Promise(() => {}));
  mocks.getMyApplication.mockReturnValue(new Promise(() => {}));
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

describe('ProductShell — 탭 상태가 결정된 프로그램 상세 스코프 배선', () => {
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

  it('overview 응답이 오기 전에는 프로그램 이름 자리를 스켈레톤으로 잡고 id를 제목으로 쓰지 않는다', () => {
    mockSession();
    const html = render('/programs/prog-1');

    expect(html).toContain('data-slot="sidebar-scope-title-skeleton"');
    expect(html).not.toContain('data-slot="sidebar-shell-scope-title"');
    expect(html).toContain('data-slot="sidebar-bottom-skeleton"');
  });

  it('비회원은 overview를 부르지 않으므로 스켈레톤 없이 id 제목을 바로 그린다', () => {
    mockSession({ status: 'anonymous', role: null, isProfileComplete: false });
    const html = render('/programs/prog-1');

    expect(html).not.toMatch(/data-slot="[a-z-]+-skeleton"/);
    expect(html).toMatch(
      /<p[^>]*data-slot="sidebar-shell-scope-title"[^>]*>prog-1<\/p>/,
    );
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

    expect(html).not.toContain('신청자');
  });

  it('참여 여부를 아직 모르는 동안에는 메뉴를 내리지 않는다(#1099)', () => {
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });

    const html = render('/programs/prog-1');

    expect(html).toContain('href="/programs/prog-1/documents"');
    expect(html).toContain('href="/programs/prog-1/board"');
  });

  it('교직원 회원은 "서류 현황"과 신청 판정 입구(팀 관리)를 본다', () => {
    mockSession({ status: 'assigned', role: 'STAFF', isProfileComplete: true });
    const html = render('/programs/prog-1');

    expect(html).toContain('서류 현황');
    expect(html).not.toContain('내 제출물');

    expect(html).toContain('팀 관리');
    expect(html).not.toContain('신청자');
    expect(html).toContain('/programs/prog-1/teams');
    expect(html).not.toContain('/programs/prog-1/applicants');
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

  it('overview 로딩 중에는 팀 수·게시판 뱃지 자리를 숫자 없이 고정 폭 스켈레톤으로 잡는다', () => {
    mockSession();
    const html = render('/programs/prog-1');

    expect(html).not.toContain('data-slot="program-scope-sidebar-count"');
    expect(html.match(/data-slot="sidebar-count-skeleton"/g)?.length).toBe(2);
  });

  it('/programs 목록은 상태별 집계를 기다리는 동안 뱃지 자리를 스켈레톤으로 잡는다', () => {
    mockSession();
    const html = render('/programs');

    expect(html).not.toContain('data-slot="app-sidebar-count"');
    expect(html).toContain('data-slot="sidebar-count-skeleton"');
  });

  it('회원 셸 그리드는 두 사이드바 모두 같은 펼침 상태로 렌더된다', () => {
    mockSession();
    const listHtml = render('/programs');
    const scopeHtml = render('/programs/prog-1');
    const shellOpen = /data-slot="product-shell"[^>]*data-collapsed="false"/;

    expect(listHtml).toMatch(shellOpen);
    expect(scopeHtml).toMatch(shellOpen);
  });

  it('접힘 쿠키(initialCollapsed)로 SSR하면 첫 HTML부터 레일 상태다', () => {
    mockSession();
    mocks.usePathname.mockReturnValue('/programs');
    const html = renderToStaticMarkup(
      <ProductShell initialCollapsed>
        <p>본문</p>
      </ProductShell>,
    );

    expect(html).toMatch(
      /data-slot="product-shell"[^>]*data-collapsed="true"[^>]*data-sidebar-phase="collapsed"/,
    );
    expect(html).toMatch(/<aside[^>]*data-collapsed="true"/);
    expect(html).toMatch(
      /data-slot="sidebar-shell-panel"[^>]*data-phase="collapsed"/,
    );
    expect(html).not.toContain('data-slot="app-sidebar-foot"');
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

  it('사이드바 셸의 #main-content는 relative 스크롤 컨테이너다(absolute 자손의 containing block)', () => {
    mockSession();
    for (const pathname of ['/programs', '/programs/prog-1', '/dashboard']) {
      const classes = mainContentClasses(render(pathname));
      expect(classes, pathname).toContain('relative');
      expect(classes, pathname).toContain('overflow-y-auto');
    }
  });

  it('사이드바 없는 셸(section null)의 #main-content도 relative 스크롤 컨테이너다', () => {
    mockSession();
    const html = render('/profile/synthetic-user');
    expect(html).not.toContain('data-slot="product-shell"');
    expect(html).not.toContain('data-slot="app-sidebar"');
    const classes = mainContentClasses(html);
    expect(classes).toContain('relative');
    expect(classes).toContain('overflow-y-auto');
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

describe('ProductShell — 모바일 스코프 바와 메뉴 시트 배선', () => {
  const SCOPE_BAR = /<div[^>]*data-slot="scope-bar"[^>]*data-scope="([a-z]+)"/;
  const TRIGGER =
    /<button[^>]*data-slot="scope-bar-menu-trigger"[^>]*>.*?<\/button>/;

  it('프로그램 상세는 프로그램 스코프 바를 그리고 버튼이 시트 dialog를 가리킨다', () => {
    mockSession();
    const html = render('/programs/prog-1');

    expect(html.match(SCOPE_BAR)?.[1]).toBe('program');
    const trigger = html.match(TRIGGER)?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-controls="shell-menu-sheet"');
    expect(trigger).toContain('프로그램 개요');

    expect(html.match(/data-slot="sidebar-shell-back"/g)).toHaveLength(2);
  });

  it('스코프 바 버튼은 현재 메뉴 라벨을 쓴다(/teams → 참여 팀)', () => {
    mockSession();
    const trigger = render('/programs/prog-1/teams').match(TRIGGER)?.[0];
    expect(trigger).toContain('참여 팀');
    expect(trigger).not.toContain('프로그램 개요');
  });

  it('프로그램 이름이 오기 전에는 스코프 바도 스켈레톤을 쓰고, 비회원은 id를 그대로 쓴다', () => {
    mockSession();
    expect(
      render('/programs/prog-1').match(
        /data-slot="sidebar-scope-title-skeleton"/g,
      ),
    ).toHaveLength(2);

    mockSession({ status: 'anonymous', role: null, isProfileComplete: false });
    const guest = render('/programs/prog-1');
    expect(guest.match(SCOPE_BAR)?.[1]).toBe('program');
    expect(
      guest.match(
        /<p[^>]*data-slot="sidebar-shell-scope-title"[^>]*>prog-1<\/p>/g,
      ),
    ).toHaveLength(2);
  });

  it('/dashboard는 브랜드 제목이 있는 대시보드 스코프 바를 그린다', () => {
    mockSession({
      status: 'assigned',
      role: 'STUDENT',
      isProfileComplete: true,
    });
    const html = render('/dashboard');

    expect(html.match(SCOPE_BAR)?.[1]).toBe('dashboard');
    expect(html).toMatch(
      /<p[^>]*data-slot="scope-bar-title"[^>]*>대시보드<\/p>/,
    );
    expect(html).toContain('aria-controls="shell-menu-sheet"');
  });

  it('필터 칩 섹션(/programs, /archive, /ranking)에는 스코프 바가 없다', () => {
    mockSession();
    for (const pathname of ['/programs', '/archive', '/ranking']) {
      const html = render(pathname);
      expect(html, pathname).toContain('data-slot="app-sidebar"');
      expect(html, pathname).not.toContain('data-slot="scope-bar"');
      expect(html, pathname).not.toContain('aria-controls="shell-menu-sheet"');
    }
  });

  it('시트는 닫힌 채 SSR되어 메뉴 nav가 중복되지 않고 dialog도 없다', () => {
    mockSession();
    const html = render('/programs/prog-1');

    expect(html.match(/data-slot="program-scope-sidebar-nav"/g)).toHaveLength(
      1,
    );
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('data-slot="shell-menu-sheet"');
  });

  it('스코프 바는 본문 스크롤러(#main-content) 바깥, 그 앞에 선다', () => {
    mockSession();
    const html = render('/programs/prog-1');
    const scopeBarAt = html.indexOf('data-slot="scope-bar"');
    const mainAt = html.indexOf('id="main-content"');
    expect(scopeBarAt).toBeGreaterThan(-1);
    expect(scopeBarAt).toBeLessThan(mainAt);
    const between = html.slice(
      html.lastIndexOf('<div', scopeBarAt),
      html.lastIndexOf('<', mainAt),
    );
    const opened = between.match(/<div[\s>]/g)?.length ?? 0;
    const closed = between.match(/<\/div>/g)?.length ?? 0;
    expect(closed).toBeGreaterThanOrEqual(opened);
  });

  it('스코프 바의 뒤로 가기 링크는 모바일 터치 변형이고, 데스크톱 레일은 변형이 없다', () => {
    mockSession();
    const html = render('/programs/prog-1');
    const scopeBarAt = html.indexOf('data-slot="scope-bar"');
    const backLinks = [
      ...html.matchAll(/<a[^>]*data-slot="sidebar-shell-back"[^>]*>/g),
    ];
    const inScopeBar = backLinks.filter((m) => (m.index ?? 0) > scopeBarAt);
    const inRail = backLinks.filter((m) => (m.index ?? 0) < scopeBarAt);

    expect(inScopeBar).toHaveLength(1);
    expect(inScopeBar[0][0]).toContain('data-variant="scope-bar"');
    expect(inRail.length).toBeGreaterThan(0);
    for (const m of inRail) expect(m[0]).not.toContain('data-variant');
  });
});
