import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NavBar } from './nav-bar';

const ITEMS = [
  { label: '홈', href: '/' },
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];

function render(currentPath?: string) {
  return renderToStaticMarkup(
    <NavBar brand={<span>OSS Hub</span>} items={ITEMS} currentPath={currentPath} />,
  );
}

function wideList(html: string): string {
  return html.match(/data-slot="nav-bar-items"[\s\S]*?<\/ul>/)?.[0] ?? '';
}

function collapsedPanel(html: string): string {
  return html.match(/data-slot="nav-bar-menu-items"[\s\S]*?<\/ul>/)?.[0] ?? '';
}

function currentLinks(list: string): string[] {
  return list.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
}

describe('NavBar 현재 탭', () => {
  it('currentPath와 같은 href 항목에 aria-current="page"와 data-current를 단다', () => {
    const html = render('/archive');
    for (const list of [wideList(html), collapsedPanel(html)]) {
      const current = currentLinks(list);
      expect(current).toHaveLength(1);
      expect(current[0]).toContain('href="/archive"');
      expect(current[0]).toContain('data-current="true"');
    }
  });

  it('하위 경로(/programs/abc)도 상위 탭을 현재로 본다', () => {
    const html = render('/programs/abc/teams');
    const current = currentLinks(wideList(html));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/programs"');
  });

  it('"/" 항목은 정확히 일치할 때만 현재다', () => {
    expect(currentLinks(wideList(render('/programs')))[0]).not.toContain(
      'href="/"',
    );
    const home = currentLinks(wideList(render('/')));
    expect(home).toHaveLength(1);
    expect(home[0]).toContain('href="/"');
  });

  it('현재 탭은 강조 색·굵기와 마커 바를, 나머지는 평범한 링크를 가진다', () => {
    const html = render('/ranking');
    const list = wideList(html);
    expect(list.match(/data-slot="nav-bar-current-marker"/g)).toHaveLength(1);
    const current = currentLinks(list)[0];
    expect(current).toContain('font-semibold');
    expect(current).toContain('text-sidebar-current-foreground');
    expect(list).toMatch(
      /data-slot="nav-bar-current-marker"[^>]*class="[^"]*\bbg-sidebar-current-marker\b/,
    );
    const others = (list.match(/<a[^>]*>/g) ?? []).filter(
      (tag) => !tag.includes('aria-current'),
    );
    expect(others).toHaveLength(ITEMS.length - 1);
    for (const tag of others) {
      expect(tag).not.toContain('font-semibold');
      expect(tag).not.toContain('data-current');
    }
  });

  it('currentPath가 없으면 어떤 항목도 현재가 아니다', () => {
    const html = render();
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('data-current');
    expect(html).not.toContain('data-slot="nav-bar-current-marker"');
  });
});
