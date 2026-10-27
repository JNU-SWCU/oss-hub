import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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

import { ProgramCountdown } from '@/components';
import { AppSidebar, formatSidebarCount } from './app-sidebar';
import type { MemberAccess } from './member-access';
import { sidebarBrandTitle, sidebarGroupsFor } from './sidebar-menu';

const STUDENT: MemberAccess = {
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
};
const STAFF_ADMIN: MemberAccess = {
  memberKind: 'STAFF',
  hasStaffAccess: true,
  hasAdminAccess: true,
};

function render(
  pathname: string,
  collapsed: boolean,
  search = '',
  section: 'programs' | 'dashboard' = 'programs',
) {
  const access = section === 'dashboard' ? STUDENT : null;
  return renderToStaticMarkup(
    <AppSidebar
      groups={sidebarGroupsFor(section, access)}
      pathname={pathname}
      search={search}
      collapsed={collapsed}
    />,
  );
}

const programCounts = {
  all: 15,
  recruiting: 3,
  in_progress: 0,
  upcoming: 0,
  ended: 9,
} as const;

function renderWithCounts(collapsed: boolean) {
  const groups = sidebarGroupsFor('programs', null, {
    programCounts: { ...programCounts },
  });
  return renderToStaticMarkup(
    <AppSidebar
      groups={groups}
      pathname="/programs"
      search=""
      collapsed={collapsed}
    />,
  );
}

describe('AppSidebar', () => {
  it('is desktop-only and keeps filters flat with distinct icons', () => {
    const html = render('/programs', false);
    expect(html).toMatch(
      /data-slot="app-sidebar"[^>]*data-breakpoint-visibility="desktop"/,
    );
    expect(html).toContain('프로그램 메뉴');
    expect(html).not.toContain('data-slot="app-sidebar-depth-children"');
    expect(html).toContain('data-depth="0"');
    expect(html).not.toContain('data-depth="1"');
    expect(html).toContain('href="/programs?status=recruiting"');
    expect(html).toContain('data-icon="megaphone"');
    expect(html).toContain('data-icon="play"');
    expect(html).not.toContain('sticky');
    expect(html).not.toContain('100dvh-3.5rem');
    expect(html).toContain('min-h-0');
    expect(html).toContain('overflow-hidden');
  });

  it('shows count badge when provided', () => {
    const html = renderWithCounts(false);
    expect(html).toContain('data-slot="app-sidebar-count"');
    expect(html).toContain('>0<');
    expect(html).toContain('>3<');
    expect(html).not.toContain('>15<');
  });

  it('dashboard section has no program filters', () => {
    const html = render('/dashboard', false, '', 'dashboard');
    expect(html).toContain('대시보드');
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain('모집중');
  });

  it('C1: collapsed hides count badges', () => {
    const html = renderWithCounts(true);
    expect(html).not.toContain('data-slot="app-sidebar-count"');
    expect(html).not.toContain('>3<');
    expect(html).not.toContain('>15<');

    expect(html).toContain('aria-label="모집중 3"');
  });

  it('C2: the aside carries no header row and no collapse toggle — the top bar owns it', () => {
    for (const collapsed of [false, true]) {
      const html = render('/programs', collapsed);
      expect(html, String(collapsed)).not.toMatch(/data-slot="[a-z-]+-brand"/);
      expect(html, String(collapsed)).not.toContain('<button');
      expect(html, String(collapsed)).not.toContain('사이드바 접기');
      expect(html, String(collapsed)).not.toContain('사이드바 펼치기');
    }
  });

  it('C3: collapsed state is exposed as data-collapsed, not a BrandMark', () => {
    const html = render('/programs', true);
    expect(html).toMatch(/data-slot="app-sidebar"[^>]*data-collapsed="true"/);
    expect(html).not.toContain('>O</span>');

    expect(render('/programs', false)).toMatch(
      /data-slot="app-sidebar"[^>]*data-collapsed="false"/,
    );
  });

  it('C4: collapsed links expose aria-label with label and count', () => {
    const html = renderWithCounts(true);
    expect(html).toContain('aria-label="모집중 3"');
    expect(html).toContain('aria-label="전체 6"');
    expect(html).toContain('aria-label="종료 9"');
  });

  it('U5: count 0 renders when expanded; collapsed never shows count slot', () => {
    const withZero = renderWithCounts(false);
    expect(withZero).toContain('data-slot="app-sidebar-count"');
    expect(withZero).toContain('>0<');

    const withoutCounts = render('/programs', false);
    expect(withoutCounts).not.toContain('data-slot="app-sidebar-count"');

    const withZeroCollapsed = renderWithCounts(true);
    expect(withZeroCollapsed).not.toContain('data-slot="app-sidebar-count"');
    expect(withZeroCollapsed).not.toContain('>0<');

    const withoutCountsCollapsed = render('/programs', true);
    expect(withoutCountsCollapsed).not.toContain(
      'data-slot="app-sidebar-count"',
    );
  });

  it('staff+admin dashboard shows two group labels and names the nav 대시보드', () => {
    const groups = sidebarGroupsFor('dashboard', STAFF_ADMIN);
    const html = renderToStaticMarkup(
      <AppSidebar
        groups={groups}
        pathname="/dashboard"
        search=""
        collapsed={false}
        brandTitle={sidebarBrandTitle('dashboard', groups)}
      />,
    );
    expect(html).toMatch(
      /data-slot="app-sidebar-nav"[^>]*aria-label="대시보드"/,
    );
    expect(html).not.toContain('>대시보드<');
    expect(html).toContain('data-slot="app-sidebar-group-label"');
    expect(html).toContain('>교직원<');
    expect(html).toContain('>관리자<');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('운영 대시보드');
    expect(html).not.toContain('관리 콘솔');
    expect(html).toContain('gap-4');
  });

  it('formatSidebarCount caps above 99', () => {
    expect(formatSidebarCount(0)).toBe('0');
    expect(formatSidebarCount(99)).toBe('99');
    expect(formatSidebarCount(100)).toBe('99+');
    expect(formatSidebarCount(1500)).toBe('99+');
  });

  it('renders the bottom slot only while expanded', () => {
    const groups = sidebarGroupsFor('ranking', null, {
      rankingYears: [2026],
    });
    const countdown = (
      <ProgramCountdown
        nextMilestoneLabel="다음 수집"
        dueAt="2026-08-21T00:00:00.000Z"
        untilLabel="다음 수집까지"
      />
    );
    const expanded = renderToStaticMarkup(
      <AppSidebar
        groups={groups}
        pathname="/ranking"
        search=""
        collapsed={false}
        bottom={countdown}
      />,
    );
    expect(expanded).toContain('data-slot="program-countdown"');

    const collapsed = renderToStaticMarkup(
      <AppSidebar
        groups={groups}
        pathname="/ranking"
        search=""
        collapsed={true}
        bottom={countdown}
      />,
    );
    expect(collapsed).not.toContain('data-slot="program-countdown"');

    const withoutBottom = renderToStaticMarkup(
      <AppSidebar
        groups={groups}
        pathname="/ranking"
        search=""
        collapsed={false}
      />,
    );
    expect(withoutBottom).not.toContain('data-slot="program-countdown"');
  });

  it('collapsed ranking years are icon-only with year in aria-label', () => {
    const groups = sidebarGroupsFor('ranking', null, {
      rankingYears: [2026, 2025],
    });
    const html = renderToStaticMarkup(
      <AppSidebar
        groups={groups}
        pathname="/ranking"
        search="?year=2026"
        collapsed={true}
      />,
    );
    expect(html).not.toContain('data-slot="app-sidebar-count"');

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const aside = doc.querySelector('aside[data-slot="app-sidebar"]');
    expect(aside?.getAttribute('data-collapsed')).toBe('true');
    const yearLinks = Array.from(
      aside?.querySelectorAll<HTMLAnchorElement>('a[aria-label]') ?? [],
    ).map((link) => link.getAttribute('aria-label'));
    expect(yearLinks).toEqual(expect.arrayContaining(['2026', '2025']));
  });
});
