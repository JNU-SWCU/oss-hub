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
  role: 'STUDENT' | null = 'STUDENT',
) {
  return renderToStaticMarkup(
    <AppSidebar
      groups={sidebarGroupsFor(role)}
      pathname={pathname}
      search={search}
      collapsed={collapsed}
      onToggle={() => {}}
    />,
  );
}

describe('AppSidebar', () => {
  it('프로그램 메뉴가 사이드 패널에 있다', () => {
    const html = render('/programs', false, '', null);
    expect(html).toContain('프로그램 메뉴');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('href="/programs?status=recruiting"');
    expect(html).toContain('href="/programs?status=in_progress"');
    expect(html).toContain('href="/programs?status=upcoming"');
    expect(html).toContain('href="/programs?status=ended"');
    expect(html).not.toContain('연습');
  });

  it('학생이면 프로그램 메뉴와 내 상황이 함께 있다', () => {
    const html = render('/dashboard', false);
    expect(html).toContain('프로그램 메뉴');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/my-repos"');
  });

  it('모집중 쿼리일 때 해당 링크만 current다', () => {
    const html = render('/programs', false, 'status=recruiting');
    expect(html).toContain('aria-current="page"');
    // 모집중 링크 줄에 current
    expect(html).toMatch(
      /href="\/programs\?status=recruiting"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/programs\?status=recruiting"/,
    );
  });

  it('접힌 상태 이름표는 hover와 keyboard focus 양쪽에서 보인다', () => {
    const html = render('/dashboard', true);
    expect(html).toContain('data-slot="app-sidebar-tooltip"');
  });

  it('메뉴는 조작 사각형 규격(h-control)을 쓴다', () => {
    const html = render('/dashboard', false);
    const links =
      html.match(/class="group relative flex h-control[^"]*"/g) ?? [];
    const menuCount = sidebarGroupsFor('STUDENT').reduce(
      (total, group) => total + group.items.length,
      0,
    );
    expect(links.length).toBe(menuCount);
  });

  it('펼친 헤더는 메뉴다', () => {
    const html = render('/dashboard', false);
    expect(html).toContain('메뉴');
  });
});
