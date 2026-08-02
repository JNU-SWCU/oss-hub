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
  it('접힌 상태에서도 메뉴가 그대로 링크다 — 펼치지 않고 눌러 이동한다', () => {
    const html = render('/dashboard', true);

    expect(html).toContain('href="/my-repos"');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('href="/archive"');
    expect(html).toContain('href="/settings"');
  });

  it('현재 위치를 색·굵기·왼쪽 막대 셋으로 표시한다', () => {
    const html = render('/dashboard', false);

    expect(html).toContain('aria-current="page"');
    // 색(배경) + 굵기 + 형태(왼쪽 막대) — 색 하나에만 기대지 않는다
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
    // 이름표는 접힌 상태의 유일한 접근성 이름이므로 aria-hidden이면 안 된다
    expect(html).not.toMatch(
      /aria-hidden="true"[^>]*data-slot="app-sidebar-tooltip"/,
    );
  });

  it('펼친 상태에서는 이름표를 만들지 않는다 — 이름이 이미 보인다', () => {
    expect(render('/dashboard', false)).not.toContain(
      'data-slot="app-sidebar-tooltip"',
    );
  });

  it('메뉴는 조작 사각형 규격(h-control)을 쓴다', () => {
    const html = render('/dashboard', false);
    const links =
      html.match(/class="group relative flex h-control[^"]*"/g) ?? [];

    expect(links.length).toBe(5);
  });

  it('접힌 상태에서는 로고가 펼치기 버튼이 된다', () => {
    const collapsed = render('/dashboard', true);
    const open = render('/dashboard', false);

    expect(collapsed).toContain('aria-label="사이드바 펼치기"');
    expect(collapsed).not.toContain('aria-label="사이드바 접기"');
    expect(open).toContain('aria-label="사이드바 접기"');
    expect(open).not.toContain('aria-label="사이드바 펼치기"');
  });

  it('펼친 상태는 랜딩과 공유하는 브랜드 링크를 쓴다', () => {
    const html = render('/dashboard', false);

    expect(html).toContain('data-slot="shell-brand"');
    expect(html).toContain('data-slot="shell-brand-mark"');
    expect(html).toContain('href="/"');
  });
});
