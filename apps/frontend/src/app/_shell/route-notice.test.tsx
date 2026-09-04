// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mocks.back,
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { PreviousPageButton, RouteNotice } from './route-notice';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('RouteNotice', () => {
  // 같은 처지의 전면 안내 셋(access-denied·login-required-notice·session-error)이 쓰는
  // 치수를 그대로 따른다. 이 뼈대가 갈라지면 주소가 틀렸을 때와 권한이 없을 때가
  // 서로 다른 서비스처럼 보인다.
  it('이웃 전면 안내와 같은 뼈대·폭·정렬을 쓴다', () => {
    const html = renderToStaticMarkup(
      <RouteNotice title="제목" description="설명" actions={null} />,
    );

    expect(html).toContain('min-h-[50svh]');
    expect(html).toContain('max-w-md');
    expect(html).toContain('break-keep');
    expect(html).toContain('text-muted-foreground');
  });

  // R-12(docs/design.md §피드백·알림) — live region은 상호작용 중 발생한 동적 error
  // 전용이고, 이 화면은 그 route의 초기 렌더 콘텐츠다.
  it('정적 초기 콘텐츠에 live region을 두지 않는다', () => {
    const html = renderToStaticMarkup(
      <RouteNotice title="제목" description="설명" actions={null} />,
    );

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('aria-live');
  });

  it('code를 주지 않으면 기술 표식 자리를 아예 그리지 않는다', () => {
    const html = renderToStaticMarkup(
      <RouteNotice title="제목" description="설명" actions={null} />,
    );

    expect(html).not.toContain('route-notice-code');
  });
});

describe('PreviousPageButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.back.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('누르면 브라우저 이력의 이전 화면으로 돌아간다', () => {
    act(() => {
      root.render(<PreviousPageButton />);
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('이전 화면');

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.back).toHaveBeenCalledTimes(1);
  });
});
