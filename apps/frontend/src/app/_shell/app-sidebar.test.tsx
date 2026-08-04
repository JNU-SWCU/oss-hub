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

import { AppSidebar } from './app-sidebar';
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
    const groups = sidebarGroupsFor('programs', null, {
      programCounts: { all: 15, recruiting: 3, in_progress: 0, upcoming: 0, ended: 9 },
    });
    const html = renderToStaticMarkup(
      <AppSidebar
        groups={groups}
        pathname="/programs"
        search=""
        collapsed={false}
        onToggle={() => {}}
      />,
    );
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
});
