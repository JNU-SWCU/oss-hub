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
  it('이웃 전면 안내와 같은 뼈대·폭·정렬을 쓴다', () => {
    const html = renderToStaticMarkup(
      <RouteNotice title="제목" description="설명" actions={null} />,
    );

    expect(html).toContain('min-h-[50svh]');
    expect(html).toContain('max-w-md');
    expect(html).toContain('break-keep');
    expect(html).toContain('text-muted-foreground');
  });

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
