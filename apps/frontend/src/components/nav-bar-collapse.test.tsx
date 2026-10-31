import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NavBar } from './nav-bar';

const ITEMS = [
  { label: '홈', href: '/' },
  { label: '프로그램', href: '/programs' },
  { label: '랭킹', href: '/ranking' },
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
  it('640px 미만에서만 접힌 메뉴를, 그 이상에서만 한 줄 메뉴를 보여 준다', () => {
    const html = render();
    const visibility = (slot: string) =>
      html.match(
        new RegExp(
          `data-slot="${slot}"[^>]*data-breakpoint-visibility="([^"]*)"`,
        ),
      )?.[1];

    expect(visibility('nav-bar-menu')).toBe('narrow');
    expect(visibility('nav-bar-items')).toBe('wide');
  });

  it('leading을 넘기면 브랜드 앞, 맨 왼쪽에 그린다', () => {
    const html = renderToStaticMarkup(
      <NavBar
        brand={<span>OSS Hub</span>}
        items={ITEMS}
        actions={<a href="/login">GitHub으로 로그인</a>}
        leading={<span data-slot="test-leading" />}
      />,
    );

    const leading = html.indexOf('data-slot="test-leading"');
    expect(leading).toBeGreaterThan(html.indexOf('data-slot="nav-bar"'));
    expect(leading).toBeLessThan(html.indexOf('data-slot="nav-bar-brand"'));
  });

  it('leading이 없으면 브랜드가 첫 자식이다', () => {
    const html = render();
    const nav = html.match(/<nav[^>]*>([\s\S]*)<\/nav>/)?.[1] ?? '';
    expect(nav.trimStart().startsWith('<div data-slot="nav-bar-brand"')).toBe(
      true,
    );
  });

  it('항목 목록 자체에는 뷰포트 기준으로 숨는 항목이 없다 — 좌측 사이드바 도달은 드로어 토글이 전담한다', () => {
    const html = render();
    const menuPanel = html.match(
      /data-slot="nav-bar-menu-items"[\s\S]*?<\/ul>/,
    )?.[0];
    const inlineList = html.match(
      /data-slot="nav-bar-items"[\s\S]*?<\/ul>/,
    )?.[0];
    for (const list of [menuPanel, inlineList]) {
      expect(list).toBeDefined();
      const children = list?.slice(list.indexOf('>') + 1);
      expect(children).not.toContain('data-breakpoint-visibility');
    }
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

describe('NavBar compactMenu={false} — 접힌 메뉴 없이 셸 분기점부터 한 줄 메뉴', () => {
  function renderFlat() {
    return renderToStaticMarkup(
      <NavBar
        brand={<span>OSS Hub</span>}
        items={ITEMS}
        actions={<a href="/login">GitHub으로 로그인</a>}
        compactMenu={false}
      />,
    );
  }

  it('<details> 접힌 메뉴와 트리거를 그리지 않는다', () => {
    const html = renderFlat();
    expect(html).not.toContain('<details');
    expect(html).not.toContain('data-slot="nav-bar-menu"');
    expect(html).not.toContain('data-slot="nav-bar-menu-trigger"');
    expect(html).not.toContain('aria-label="메뉴"');
  });

  it('한 줄 메뉴는 데스크톱(셸 분기점) 전용으로 모든 항목을 담는다', () => {
    const html = renderFlat();
    expect(html).toMatch(
      /data-slot="nav-bar-items"[^>]*data-breakpoint-visibility="desktop"/,
    );
    const inlineList = html.match(
      /data-slot="nav-bar-items"[\s\S]*?<\/ul>/,
    )?.[0];
    const hrefs = Array.from(
      inlineList?.matchAll(/href="([^"]*)"/g) ?? [],
      (match) => match[1],
    );
    expect(hrefs).toEqual(ITEMS.map((item) => item.href));
  });

  it('기본값(compactMenu 생략)은 여전히 접힌 메뉴를 그린다', () => {
    const html = render();
    expect(html).toContain('<details');
    expect(html).toMatch(
      /data-slot="nav-bar-items"[^>]*data-breakpoint-visibility="wide"/,
    );
  });
});
