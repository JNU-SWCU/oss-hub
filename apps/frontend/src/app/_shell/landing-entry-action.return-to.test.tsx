import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeLoginDestination } from '@/features/auth/login-destination';
import { githubLoginPath } from '@/features/auth/login-paths';
import { LandingEntryActionView } from './landing-entry-action';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('랜딩 진입 버튼의 원래 목적지 보존', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  function render(returnTo: string | null) {
    act(() =>
      root.render(
        <LandingEntryActionView
          status="anonymous"
          isProfileComplete={false}
          returnTo={returnTo}
        />,
      ),
    );
  }
  function click(path: string) {
    const link = container.querySelector<HTMLAnchorElement>(
      `a[href="${path}"]`,
    );
    if (!link) throw new Error('Expected OAuth link');
    link.addEventListener('click', (event) => event.preventDefault());
    act(() => {
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
  }
  it('GitHub으로 나가기 전에 랜딩이 받은 목적지를 저장한다', () => {
    render('/programs/42/apply');

    click(githubLoginPath);

    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
  it('목적지 없이 들어온 방문자는 아무것도 저장하지 않는다', () => {
    render(null);

    click(githubLoginPath);

    expect(sessionStorage.getItem('oss-hub-login-destination')).toBeNull();
  });
});
