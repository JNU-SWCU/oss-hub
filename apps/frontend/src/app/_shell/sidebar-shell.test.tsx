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

import {
  SIDEBAR_ASIDE_ID,
  SidebarFoot,
  SidebarScopeRow,
  SidebarShell,
} from './sidebar-shell';

const NAV = (
  <nav data-slot="app-sidebar-nav" aria-label="프로그램 메뉴">
    <span>전체</span>
  </nav>
);

function slots(html: string): string[] {
  return [...html.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]);
}

function render(
  overrides: Partial<React.ComponentProps<typeof SidebarShell>> = {},
) {
  return renderToStaticMarkup(
    <SidebarShell
      kind="app-sidebar"
      collapsed={false}
      nav={NAV}
      {...overrides}
    />,
  );
}

describe('SidebarShell', () => {
  it('aside 변형은 데스크톱 전용 aside 하나로 nav를 감싸고 헤더 행이 없다', () => {
    const html = render();
    expect(html).toMatch(
      /<aside[^>]*id="app-sidebar-aside"[^>]*data-slot="app-sidebar"[^>]*data-breakpoint-visibility="desktop"[^>]*data-collapsed="false"/,
    );
    expect(SIDEBAR_ASIDE_ID).toBe('app-sidebar-aside');
    expect(html.match(/<aside\b/g)).toHaveLength(1);
    expect(slots(html)).toEqual([
      'app-sidebar',
      'sidebar-shell-panel',
      'app-sidebar-nav',
      'app-sidebar-foot',
    ]);
    expect(html).not.toMatch(/<(header|h[1-6]|hr)\b/);
    expect(html).not.toMatch(/data-slot="[a-z-]+-brand"/);
  });

  it('kind에 따라 data-slot과 footer 슬롯 이름이 바뀐다', () => {
    const html = render({ kind: 'program-scope-sidebar' });
    expect(html).toMatch(/<aside[^>]*data-slot="program-scope-sidebar"/);
    expect(html).toContain('data-slot="program-scope-sidebar-foot"');
    expect(html).not.toContain('data-slot="app-sidebar-foot"');

    expect(render()).toContain('data-slot="app-sidebar-foot"');
  });

  it('scope row는 넘겼을 때만, nav보다 앞에 그린다', () => {
    expect(render()).not.toContain('data-slot="sidebar-shell-scope"');

    const html = render({ scope: <span data-slot="test-scope">범위</span> });
    const scope = html.indexOf('data-slot="sidebar-shell-scope"');
    expect(scope).toBeGreaterThan(-1);
    expect(scope).toBeLessThan(html.indexOf('data-slot="app-sidebar-nav"'));
    expect(html).toContain('data-slot="test-scope"');
  });

  it('bottom 슬롯은 펼쳤을 때만 nav 뒤, footer 앞에 그린다', () => {
    const bottom = <div data-slot="test-bottom">카운트다운</div>;
    const html = render({ bottom });
    const at = html.indexOf('data-slot="test-bottom"');
    expect(at).toBeGreaterThan(html.indexOf('data-slot="app-sidebar-nav"'));
    expect(at).toBeLessThan(html.indexOf('data-slot="app-sidebar-foot"'));

    expect(render({ bottom, collapsed: true })).not.toContain(
      'data-slot="test-bottom"',
    );
  });

  it('footer는 접으면 그리지 않는다', () => {
    const expanded = render();
    expect(expanded).toContain('data-slot="app-sidebar-foot"');
    expect(expanded).toContain('전남대학교');

    const collapsed = render({ collapsed: true });
    expect(collapsed).toMatch(
      /data-slot="app-sidebar"[^>]*data-collapsed="true"/,
    );
    expect(collapsed).not.toContain('data-slot="app-sidebar-foot"');
    expect(collapsed).not.toContain('전남대학교');
  });

  it('aside 안에는 사이드바 접기 버튼이 없다', () => {
    for (const collapsed of [false, true]) {
      const html = render({ collapsed });
      expect(html, String(collapsed)).not.toContain('<button');
      expect(html, String(collapsed)).not.toContain('사이드바 접기');
      expect(html, String(collapsed)).not.toContain('사이드바 펼치기');
    }
  });

  it('데스크톱 전용 aside 하나밖에 그리지 않는다 — 드로어 변형은 없다', () => {
    const html = render({ kind: 'program-scope-sidebar' });
    expect(html.match(/data-breakpoint-visibility="desktop"/g)).toHaveLength(1);
    expect(html).not.toContain('data-variant');
    expect(html).not.toContain('data-slot="sidebar-shell"');
  });

  it('SidebarFoot은 kind에 맞는 슬롯으로 같은 호스트 푸터를 그린다', () => {
    const html = renderToStaticMarkup(
      <SidebarFoot kind="program-scope-sidebar" />,
    );
    expect(html).toMatch(
      /<p[^>]*data-slot="program-scope-sidebar-foot"[^>]*>전남대학교<br\/>SW중심대학사업단<\/p>/,
    );
  });
});

describe('SidebarScopeRow', () => {
  it('펼침: 뒤로 링크와 잘리는 제목을 그린다', () => {
    const html = renderToStaticMarkup(
      <SidebarScopeRow
        backHref="/programs?status=in_progress"
        backLabel="프로그램 목록"
        title="2026-2 오픈소스 SW 프로젝트"
        collapsed={false}
      />,
    );
    expect(html).toMatch(
      /<a[^>]*href="\/programs\?status=in_progress"[^>]*data-slot="sidebar-shell-back"[^>]*>‹ 프로그램 목록<\/a>/,
    );
    expect(html).toMatch(
      /<p[^>]*data-slot="sidebar-shell-scope-title"[^>]*>2026-2 오픈소스 SW 프로젝트<\/p>/,
    );
    expect(html).not.toContain('aria-label="프로그램 목록"');
  });

  it('접힘: 아이콘 뒤로 링크만 남기고 라벨은 aria-label과 툴팁으로 옮긴다', () => {
    const html = renderToStaticMarkup(
      <SidebarScopeRow
        backHref="/programs"
        backLabel="프로그램 목록"
        title="2026-2 오픈소스 SW 프로젝트"
        collapsed
      />,
    );
    const link = html.match(/<a[^>]*data-slot="sidebar-shell-back"[^>]*>/)?.[0];
    expect(link).toBeDefined();
    expect(link).toContain('href="/programs"');
    expect(link).toContain('aria-label="프로그램 목록"');
    expect(html).toContain('data-icon="chevronLeft"');
    expect(html).not.toContain('‹ 프로그램 목록');
    expect(html).not.toContain('2026-2 오픈소스 SW 프로젝트');
  });
});
