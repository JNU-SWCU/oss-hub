// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RouteError from './error';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function renderError(digest?: string): string {
  const error = Object.assign(
    new Error('Cannot read properties of undefined'),
    {
      digest,
    },
  );
  return renderToStaticMarkup(<RouteError error={error} reset={() => {}} />);
}

/**
 * #1103 — 화면을 그리다 예외가 나면 프레임워크 기본 화면이 받던 자리.
 */
describe('렌더 실패 화면', () => {
  it('한국어 안내와 빠져나갈 길 둘을 함께 준다', () => {
    const html = renderError();

    expect(html).toContain('화면을 여는 중 문제가 생겼습니다');
    expect(html).toContain('잠시 후 다시 시도해 주세요');
    expect(html).toContain('다시 시도');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('프로그램 목록으로');
  });

  // 배포 빌드에서 서버가 던진 메시지는 Next가 지우고 digest만 남긴다. 개발 빌드에서는
  // 내부 구현이 영어 그대로 드러나므로, 어느 쪽이든 화면에 옮기지 않는다.
  it('예외 메시지를 화면에 옮기지 않는다', () => {
    const html = renderError('9f1c2a');

    expect(html).not.toContain('Cannot read properties of undefined');
    expect(html.replace(/<[^>]*>/g, '')).not.toMatch(/[A-Za-z]{3,}/);
  });

  it('추적용 digest는 본문 아래 작은 글자로만 남긴다', () => {
    const withDigest = renderError('9f1c2a');
    const withoutDigest = renderError();

    expect(withDigest).toMatch(
      /data-slot="route-notice-code"[^>]*text-xs[^>]*>오류 코드 9f1c2a</,
    );
    expect(withDigest).not.toMatch(/<h1[^>]*>[^<]*9f1c2a/);
    expect(withoutDigest).not.toContain('route-notice-code');
  });

  it('삽화·아이콘을 두지 않는다', () => {
    const html = renderError();

    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<img');
  });
});

/**
 * 버튼이 서 있는 것과 눌러서 복구되는 것은 다르다. 「다시 시도」가 Next가 넘겨준
 * `reset`에 실제로 연결돼 있는지 눌러서 확인한다.
 */
describe('렌더 실패 화면 — 다시 시도', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('누르면 Next가 넘겨준 reset을 호출한다', () => {
    const reset = vi.fn();
    act(() => {
      root.render(<RouteError error={new Error('boom')} reset={reset} />);
    });

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '다시 시도',
    );
    expect(retry).toBeDefined();

    act(() => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
