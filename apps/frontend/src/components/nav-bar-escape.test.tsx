// @vitest-environment happy-dom

// 접힌 메뉴의 Escape 닫기(QA12).
//
// ⚠ 이 파일이 SSR 문자열 테스트(`nav-bar-collapse.test.tsx`)와 따로 있는 이유가 있다.
// `renderToStaticMarkup` 은 이벤트를 발생시킬 수 없어 「Escape 로 닫힌다」를 표현조차
// 못 한다. 원래 코드 주석이 「Esc 닫기도 브라우저가 처리한다」고 잘못 적고 있었는데,
// 그 말을 검증할 테스트가 없어서 아무도 틀린 것을 몰랐다. 여기서는 실제로 키를 누른다.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NavBar } from './nav-bar';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const ITEMS = [
  { label: '프로그램', href: '/programs' },
  { label: '공개 아카이브', href: '/archive' },
  { label: '랭킹', href: '/ranking' },
];

describe('NavBar 접힌 메뉴 — Escape 로 닫힌다', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<NavBar items={ITEMS} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function menu(): HTMLDetailsElement {
    const el = container.querySelector<HTMLDetailsElement>(
      'details[data-slot="nav-bar-menu"]',
    );
    if (el === null) throw new Error('접힌 메뉴를 찾지 못했습니다');
    return el;
  }

  function trigger(): HTMLElement {
    const el = container.querySelector<HTMLElement>(
      '[data-slot="nav-bar-menu-trigger"]',
    );
    if (el === null) throw new Error('메뉴 트리거를 찾지 못했습니다');
    return el;
  }

  async function pressEscape(from: HTMLElement): Promise<void> {
    await act(async () => {
      from.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  it('열린 메뉴에서 Escape 를 누르면 닫힌다', async () => {
    const details = menu();
    await act(async () => {
      details.open = true;
    });
    expect(details.open).toBe(true);

    await pressEscape(trigger());

    expect(details.open).toBe(false);
  });

  it('메뉴 안의 링크에서 눌러도 닫힌다', async () => {
    // 실제 사용자는 메뉴를 열고 항목 사이를 Tab 으로 옮긴 상태에서 Escape 를 누른다.
    const details = menu();
    await act(async () => {
      details.open = true;
    });
    const link = details.querySelector<HTMLElement>('a');
    if (link === null) throw new Error('메뉴 항목을 찾지 못했습니다');

    await pressEscape(link);

    expect(details.open).toBe(false);
  });

  it('닫은 뒤 초점이 메뉴 트리거로 돌아온다', async () => {
    // 사라진 요소에 초점이 남으면 다음 Tab 이 문서 처음으로 튄다.
    const details = menu();
    await act(async () => {
      details.open = true;
    });
    const link = details.querySelector<HTMLElement>('a');
    link?.focus();

    await pressEscape(link ?? trigger());

    expect(document.activeElement).toBe(trigger());
  });

  it('닫혀 있을 때의 Escape 는 아무것도 하지 않는다', async () => {
    // 셸의 다른 Escape 처리를 이 메뉴가 가로채면 안 된다.
    const details = menu();
    expect(details.open).toBe(false);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      trigger().dispatchEvent(event);
    });

    expect(details.open).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('다른 키는 메뉴를 닫지 않는다', async () => {
    const details = menu();
    await act(async () => {
      details.open = true;
    });

    await act(async () => {
      trigger().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(details.open).toBe(true);
  });
});
