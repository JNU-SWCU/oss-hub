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
    <NavBar
      brand={<span>OSS Hub</span>}
      items={ITEMS}
      currentPath={currentPath}
    />,
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

  it('현재 탭만 마커를 품고, 나머지는 현재 표시가 없는 평범한 링크다', () => {
    const html = render('/ranking');
    const doc = new DOMParser().parseFromString(wideList(html), 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));
    expect(links).toHaveLength(ITEMS.length);
    const current = links.filter(
      (link) => link.getAttribute('aria-current') === 'page',
    );
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/ranking');
    expect(current[0].dataset.current).toBe('true');
    expect(
      doc.querySelectorAll('[data-slot="nav-bar-current-marker"]'),
    ).toHaveLength(1);
    expect(collapsedPanel(html)).not.toContain('nav-bar-current-marker');
    expect(
      current[0].parentElement?.querySelector(
        '[data-slot="nav-bar-current-marker"]',
      ),
    ).not.toBeNull();
    for (const link of links.filter((l) => l !== current[0])) {
      expect(link.hasAttribute('aria-current')).toBe(false);
      expect(link.hasAttribute('data-current')).toBe(false);
      expect(
        link.parentElement?.querySelector(
          '[data-slot="nav-bar-current-marker"]',
        ),
      ).toBeNull();
    }
  });

  it('currentPath가 없으면 어떤 항목도 현재가 아니다', () => {
    const html = render();
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('data-current');
    expect(html).not.toContain('data-slot="nav-bar-current-marker"');
  });

  it('compactMenu={false}면 현재 탭이 한 줄 메뉴에 한 번만 나온다', () => {
    const html = renderToStaticMarkup(
      <NavBar items={ITEMS} currentPath="/programs/abc" compactMenu={false} />,
    );
    const current = currentLinks(html);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/programs"');
    expect(collapsedPanel(html)).toBe('');
  });
});
