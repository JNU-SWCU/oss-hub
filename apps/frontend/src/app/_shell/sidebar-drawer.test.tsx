// @vitest-environment happy-dom

// SidebarDrawer의 dialog 접근성 계약을 실제 DOM 상호작용으로 검증한다.
// `renderToStaticMarkup`은 이벤트·포커스를 낼 수 없어(nav-bar-escape.test.tsx와
// 같은 이유) 여기서는 실제로 키를 누르고 포커스를 옮긴다.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarDrawer, SIDEBAR_DRAWER_DIALOG_ID } from './sidebar-drawer';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function Content() {
  return (
    <nav>
      <a href="/programs">프로그램</a>
      <a href="/archive">공개 아카이브</a>
    </nav>
  );
}

describe('SidebarDrawer', () => {
  let container: HTMLDivElement;
  let root: Root;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    // 열기 전 포커스를 여기 둔다 — 실제 사용에서는 햄버거 트리거가 이 자리다.
    trigger = document.createElement('button');
    trigger.textContent = '사이드바 메뉴 열기';
    document.body.append(trigger);
    trigger.focus();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    trigger.remove();
    document.body.style.overflow = '';
  });

  async function renderDrawer(open: boolean, onClose: () => void) {
    await act(async () => {
      root.render(
        <SidebarDrawer open={open} onClose={onClose} label="메뉴">
          <Content />
        </SidebarDrawer>,
      );
    });
  }

  it('닫혀 있을 때는 아무것도 렌더하지 않는다', async () => {
    await renderDrawer(false, () => {});
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('role=dialog, aria-modal, aria-label을 단다', async () => {
    await renderDrawer(true, () => {});
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('메뉴');
    expect(dialog?.id).toBe(SIDEBAR_DRAWER_DIALOG_ID);
  });

  it('열리면 첫 포커서블 요소로 포커스가 이동한다', async () => {
    await renderDrawer(true, () => {});
    const closeButton = container.querySelector<HTMLElement>(
      '[aria-label="사이드바 메뉴 닫기"]',
    );
    expect(document.activeElement).toBe(closeButton);
  });

  it('닫히면(트리거로) 열기 전 포커스로 복귀한다', async () => {
    await renderDrawer(true, () => {});
    await renderDrawer(false, () => {});
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape를 누르면 onClose가 호출된다', async () => {
    const onClose = vi.fn();
    await renderDrawer(true, onClose);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('배경 스크롤을 잠근다', async () => {
    expect(document.body.style.overflow).toBe('');
    await renderDrawer(true, () => {});
    expect(document.body.style.overflow).toBe('hidden');
    await renderDrawer(false, () => {});
    expect(document.body.style.overflow).toBe('');
  });

  it('Tab이 드로어 밖으로 나가지 않는다(포커스 트랩) — 마지막에서 Tab하면 첫 요소로', async () => {
    await renderDrawer(true, () => {});
    const dialog = container.querySelector('[role="dialog"]');
    const focusables = dialog?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    expect(focusables).toBeDefined();
    const first = focusables?.[0];
    const last = focusables?.[focusables.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    last?.focus();
    await act(async () => {
      last?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(first);
  });

  it('Tab이 드로어 밖으로 나가지 않는다(포커스 트랩) — 첫 요소에서 Shift+Tab하면 마지막 요소로', async () => {
    await renderDrawer(true, () => {});
    const dialog = container.querySelector('[role="dialog"]');
    const focusables = dialog?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    const first = focusables?.[0];
    const last = focusables?.[focusables.length - 1];

    first?.focus();
    await act(async () => {
      first?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);
  });

  it('배경(backdrop) 클릭 시 onClose가 호출된다', async () => {
    const onClose = vi.fn();
    await renderDrawer(true, onClose);
    const backdrop = container.querySelector<HTMLElement>(
      '[data-slot="sidebar-drawer-backdrop"]',
    );
    expect(backdrop).not.toBeNull();

    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('닫기 버튼 클릭 시 onClose가 호출된다', async () => {
    const onClose = vi.fn();
    await renderDrawer(true, onClose);
    const closeButton = container.querySelector<HTMLElement>(
      '[aria-label="사이드바 메뉴 닫기"]',
    );

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('children으로 넘긴 메뉴 콘텐츠를 그대로 렌더한다', async () => {
    await renderDrawer(true, () => {});
    expect(container.querySelector('a[href="/programs"]')).not.toBeNull();
    expect(container.querySelector('a[href="/archive"]')).not.toBeNull();
  });
});
