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

import { AppSidebar, formatSidebarCount } from './app-sidebar';
import { sidebarGroupsFor } from './sidebar-menu';

function render(
  pathname: string,
  collapsed: boolean,
  search = '',
  section: 'programs' | 'dashboard' = 'programs',
) {
  const role = section === 'dashboard' ? 'STUDENT' : null;
  return renderToStaticMarkup(
    <AppSidebar
      groups={sidebarGroupsFor(section, role)}
      pathname={pathname}
      search={search}
      collapsed={collapsed}
      onToggle={() => {}}
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
      onToggle={() => {}}
    />,
  );
}

describe('AppSidebar', () => {
  it('is desktop-only and keeps filters flat with distinct icons', () => {
    const html = render('/programs', false);
    expect(html).toContain('hidden min-[900px]:flex');
    expect(html).toContain('프로그램 메뉴');
    expect(html).not.toContain('data-slot="app-sidebar-depth-children"');
    expect(html).toContain('data-depth="0"');
    expect(html).not.toContain('data-depth="1"');
    expect(html).toContain('href="/programs?status=recruiting"');
    expect(html).toContain('data-icon="megaphone"');
    expect(html).toContain('data-icon="play"');
  });

  it('shows count badge when provided', () => {
    const html = renderWithCounts(false);
    expect(html).toContain('data-slot="app-sidebar-count"');
    expect(html).toContain('>0<');
    expect(html).toContain('>15<');
  });

  it('dashboard section has no program filters', () => {
    const html = render('/dashboard', false, '', 'dashboard');
    expect(html).toContain('대시보드');
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain('모집중');
  });

  // C1 — collapsed keeps count badges visible (not hidden solely by `hidden`)
  it('C1: collapsed keeps count badges visible', () => {
    const html = renderWithCounts(true);
    expect(html).toContain('data-slot="app-sidebar-count"');
    // count slot must not be the element that is itself class-hidden
    const countSlots = html.match(/data-slot="app-sidebar-count"[^>]*>/g);
    expect(countSlots?.length).toBeGreaterThan(0);
    for (const slot of countSlots ?? []) {
      // class may exist but must not include standalone `hidden` that hides the badge
      const classMatch = slot.match(/class="([^"]*)"/);
      if (classMatch) {
        const classes = classMatch[1].split(/\s+/);
        expect(classes).not.toContain('hidden');
      }
    }
    expect(html).toContain('>3<');
    expect(html).toContain('>15<');
  });

  // C2 — same toggle object; aria-label + aria-expanded by state
  it('C2: toggle aria-label and aria-expanded for both collapsed states', () => {
    const open = render('/programs', false);
    expect(open).toContain('aria-label="사이드바 접기"');
    expect(open).toMatch(/aria-expanded="?true"?/);

    const closed = render('/programs', true);
    expect(closed).toContain('aria-label="사이드바 펼치기"');
    expect(closed).toMatch(/aria-expanded="?false"?/);
  });

  // C3 — no BrandMark "O" when collapsed; chevron present
  it('C3: collapsed uses chevron toggle, not BrandMark', () => {
    const html = render('/programs', true);
    expect(html).not.toMatch(
      /place-items-center rounded-control bg-primary[^>]*>\s*O\s*</,
    );
    // BrandMark was a grid size-8 with letter O — must not appear as toggle content
    expect(html).not.toContain('>O</span>');
    expect(html).toContain('rotate-180');
  });

  // C4 — collapsed links carry aria-label with label + count
  it('C4: collapsed links expose aria-label with label and count', () => {
    const html = renderWithCounts(true);
    expect(html).toContain('aria-label="모집중 3"');
    expect(html).toContain('aria-label="전체 15"');
    expect(html).toContain('aria-label="종료 9"');
  });

  // U5 — count 0 renders; undefined does not create count slot
  it('U5: count 0 renders; undefined count has no count slot', () => {
    const withZero = renderWithCounts(false);
    expect(withZero).toContain('data-slot="app-sidebar-count"');
    expect(withZero).toContain('>0<');

    const withoutCounts = render('/programs', false);
    expect(withoutCounts).not.toContain('data-slot="app-sidebar-count"');

    const withZeroCollapsed = renderWithCounts(true);
    expect(withZeroCollapsed).toContain('>0<');
    expect(withZeroCollapsed).toContain('data-slot="app-sidebar-count"');

    const withoutCountsCollapsed = render('/programs', true);
    expect(withoutCountsCollapsed).not.toContain(
      'data-slot="app-sidebar-count"',
    );
  });

  it('formatSidebarCount caps above 99', () => {
    expect(formatSidebarCount(0)).toBe('0');
    expect(formatSidebarCount(99)).toBe('99');
    expect(formatSidebarCount(100)).toBe('99+');
    expect(formatSidebarCount(1500)).toBe('99+');
  });

  it('collapsed ranking years show year metric without count slot', () => {
    const groups = sidebarGroupsFor('ranking', null, {
      rankingYears: [2026, 2025],
    });
    const html = renderToStaticMarkup(
      <AppSidebar
        groups={groups}
        pathname="/ranking"
        search="?year=2026"
        collapsed={true}
        onToggle={() => {}}
      />,
    );
    expect(html).toContain('>2026<');
    expect(html).toContain('>2025<');
    // years have no backend count → no count slot
    expect(html).not.toContain('data-slot="app-sidebar-count"');
    expect(html).toContain('aria-label="2026"');
  });
});
