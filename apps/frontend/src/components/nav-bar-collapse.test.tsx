import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NavBar } from './nav-bar';

const ITEMS = [
  { label: '홈', href: '/' },
  { label: '프로그램', href: '/programs' },
  { label: '아카이브', href: '/archive' },
];

function render() {
  return renderToStaticMarkup(
    <NavBar
      brand={<span>OSS Hub</span>}
      items={ITEMS}
      actions={<a href="/login">GitHub으로 로그인</a>}
    />,
  );
}

describe('NavBar 좁은 화면 메뉴 접기', () => {
  it('900px 미만에서만 접힌 메뉴를, 그 이상에서만 한 줄 메뉴를 보여 준다', () => {
    const html = render();
    const menuClass = html.match(
      /data-slot="nav-bar-menu"[^>]*class="([^"]*)"/,
    )?.[1];
    const itemsClass = html.match(
      /data-slot="nav-bar-items"[^>]*class="([^"]*)"/,
    )?.[1];

    expect(menuClass?.split(' ')).toContain('min-[900px]:hidden');
    expect(itemsClass?.split(' ')).toContain('hidden');
    expect(itemsClass?.split(' ')).toContain('min-[900px]:flex');
    expect(menuClass).not.toContain('min-[480px]');
    expect(itemsClass).not.toContain('min-[480px]');
  });

  it('onToggleSidebarDrawer가 있으면 900px 미만 전용 사이드바 드로어 토글을 그린다', () => {
    const html = renderToStaticMarkup(
      <NavBar
        brand={<span>OSS Hub</span>}
        items={ITEMS}
        actions={<a href="/login">GitHub으로 로그인</a>}
        sidebarDrawerOpen={false}
        onToggleSidebarDrawer={() => {}}
        sidebarDrawerId="app-sidebar-drawer"
      />,
    );

    const trigger = html.match(
      /<button[^>]*data-slot="nav-bar-sidebar-drawer-trigger"[^>]*>/,
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain('min-[900px]:hidden');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-controls="app-sidebar-drawer"');
  });

  it('onToggleSidebarDrawer가 없으면 사이드바 드로어 토글을 그리지 않는다', () => {
    expect(render()).not.toContain(
      'data-slot="nav-bar-sidebar-drawer-trigger"',
    );
  });

  it('항목 목록 자체에는 900px 기준으로 숨는 항목이 없다 — 좌측 사이드바 도달은 드로어 토글이 전담한다', () => {
    const html = render();
    const menuPanel = html.match(
      /data-slot="nav-bar-menu-items"[\s\S]*?<\/ul>/,
    )?.[0];
    const inlineList = html.match(
      /data-slot="nav-bar-items"[\s\S]*?<\/ul>/,
    )?.[0];
    expect(menuPanel).not.toContain('min-[900px]:hidden');
    expect(inlineList).not.toContain('min-[900px]:hidden');
  });

  it('접힌 메뉴도 같은 링크를 모두 담는다 — 좁은 화면에서 길이 끊기지 않는다', () => {
    const panel = render().match(
      /data-slot="nav-bar-menu-items"[\s\S]*?<\/ul>/,
    )?.[0];

    for (const item of ITEMS) {
      expect(panel).toContain(`href="${item.href}"`);
      expect(panel).toContain(item.label);
    }
  });

  it('여는 버튼과 접힌 메뉴 항목은 터치 타깃 44px을 지킨다', () => {
    const html = render();

    expect(html).toMatch(
      /data-slot="nav-bar-menu-trigger"[^>]*class="[^"]*\bsize-11\b/,
    );
    const panel = html.match(
      /data-slot="nav-bar-menu-items"[\s\S]*?<\/ul>/,
    )?.[0];
    expect(panel?.match(/min-h-11/g)).toHaveLength(ITEMS.length);

    expect(panel?.match(/\bw-full\b/g)).toHaveLength(ITEMS.length);
  });

  it('접기·펼치기 상태는 <details>가 들고 있다 — 이 컴포넌트는 클라이언트가 되지 않는다', () => {
    const html = render();

    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('aria-label="메뉴"');
  });

  it('접힌 메뉴 패널은 data-surface="default" 리셋을 단다', () => {
    expect(render()).toMatch(
      /data-slot="nav-bar-menu-items"[^>]*data-surface="default"/,
    );
  });

  it('menuResetKey 가 바뀌면 접힌 메뉴를 새로 그린다', () => {
    const first = renderToStaticMarkup(
      <NavBar items={ITEMS} menuResetKey="/" />,
    );
    const second = renderToStaticMarkup(
      <NavBar items={ITEMS} menuResetKey="/programs" />,
    );

    expect(first).toBe(second);

    expect(first).toContain('data-slot="nav-bar-menu"');
  });
});
