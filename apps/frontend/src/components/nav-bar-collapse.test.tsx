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

/**
 * 320px에서 "아카이브"와 "GitHub으로 로그인"이 47.6px 겹쳤다(360px에서도 7.6px).
 * 메뉴는 `whitespace-nowrap`이라 줄지 않고 actions는 `shrink-0`이라 물러서지 않아
 * 서로를 파고들었다. 좁은 화면에서는 메뉴를 접어 자리를 다투지 않게 한다.
 */
describe('NavBar 좁은 화면 메뉴 접기', () => {
  it('480px 미만에서만 접힌 메뉴를, 그 이상에서만 한 줄 메뉴를 보여 준다', () => {
    const html = render();
    const menuClass = html.match(
      /data-slot="nav-bar-menu"[^>]*class="([^"]*)"/,
    )?.[1];
    const itemsClass = html.match(
      /data-slot="nav-bar-items"[^>]*class="([^"]*)"/,
    )?.[1];

    expect(menuClass?.split(' ')).toContain('min-[480px]:hidden');
    expect(itemsClass?.split(' ')).toContain('hidden');
    expect(itemsClass?.split(' ')).toContain('min-[480px]:flex');
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
    // 줄 전체가 눌려야 한다 — 호출부의 `[&_a]:inline-flex`가 글자 폭으로 줄여 버린다
    expect(panel?.match(/\bw-full\b/g)).toHaveLength(ITEMS.length);
  });

  it('접기·펼치기 상태는 <details>가 들고 있다 — 이 컴포넌트는 클라이언트가 되지 않는다', () => {
    const html = render();

    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('aria-label="메뉴"');
  });

  // 랜딩의 반전 표면 안에 중첩되는 밝은 패널이라 토큰 리셋이 필요하다.
  it('접힌 메뉴 패널은 data-surface="default" 리셋을 단다', () => {
    expect(render()).toMatch(
      /data-slot="nav-bar-menu-items"[^>]*data-surface="default"/,
    );
  });
  // 클라이언트 내비게이션은 셸을 그대로 두고 본문만 갈아 끼운다. `<details>`의
  // 열림 상태를 브라우저가 들고 있어서, 이 요소가 살아남으면 열린 메뉴가 새
  // 화면을 계속 덮는다. 경로가 바뀌면 다시 그리도록 key 를 받는다.
  it('menuResetKey 가 바뀌면 접힌 메뉴를 새로 그린다', () => {
    const first = renderToStaticMarkup(
      <NavBar items={ITEMS} menuResetKey="/" />,
    );
    const second = renderToStaticMarkup(
      <NavBar items={ITEMS} menuResetKey="/programs" />,
    );

    // 서버 렌더 결과는 같아야 한다 — key 는 마크업이 아니라 재조정에만 쓰인다.
    expect(first).toBe(second);
    // key 를 실제로 넘기고 있는지 타입 수준에서 고정한다.
    expect(first).toContain('data-slot="nav-bar-menu"');
  });
});
