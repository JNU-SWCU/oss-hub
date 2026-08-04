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

function render(pathname: string, collapsed: boolean) {
  return renderToStaticMarkup(
    <AppSidebar
      groups={sidebarGroupsFor('STUDENT')}
      pathname={pathname}
      collapsed={collapsed}
      onToggle={() => {}}
    />,
  );
}

describe('AppSidebar', () => {
  it('내 상황 링크만 있다 — 공개·설정은 없다', () => {
    const html = render('/dashboard', true);

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/my-repos"');
    expect(html).not.toContain('href="/programs"');
    expect(html).not.toContain('href="/archive"');
    expect(html).not.toContain('href="/settings"');
  });

  it('현재 위치를 색·굵기·왼쪽 막대 셋으로 표시한다', () => {
    const html = render('/dashboard', false);

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('bg-sidebar-current');
    expect(html).toContain('font-semibold');
    expect(html).toContain('data-slot="app-sidebar-current-marker"');
  });

  it('현재 위치가 아닌 메뉴에는 표식을 달지 않는다', () => {
    const html = render('/dashboard', false);
    const markers = html.match(/data-slot="app-sidebar-current-marker"/g) ?? [];
    expect(markers).toHaveLength(1);
  });

  it('접힌 상태 이름표는 hover와 keyboard focus 양쪽에서 보인다', () => {
    const html = render('/dashboard', true);
    expect(html).toContain('data-slot="app-sidebar-tooltip"');
    expect(html).toContain('group-hover:opacity-100');
    expect(html).toContain('group-focus-visible:opacity-100');
  });

  it('펼친 상태에서는 이름표를 만들지 않는다', () => {
    expect(render('/dashboard', false)).not.toContain(
      'data-slot="app-sidebar-tooltip"',
    );
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

  it('접힌 상태에서는 펼치기 버튼이 된다', () => {
    const collapsed = render('/dashboard', true);
    const open = render('/dashboard', false);

    expect(collapsed).toContain('aria-label="사이드바 펼치기"');
    expect(open).toContain('aria-label="사이드바 접기"');
  });

  it('펼친 헤더는 OSS Hub 브랜드가 아니라 내 상황이다', () => {
    const html = render('/dashboard', false);
    expect(html).toContain('내 상황');
    // 브랜드 홈 링크를 사이드바에 두지 않는다(상단 Nav 재사용)
    expect(html).not.toMatch(
      /data-slot="app-sidebar-brand"[\s\S]*href="\/"/,
    );
  });
});
