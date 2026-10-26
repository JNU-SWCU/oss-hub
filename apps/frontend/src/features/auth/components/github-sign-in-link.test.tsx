import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  rememberLoginDestination,
  takeLoginDestination,
} from '@/features/auth/login-destination';
import {
  githubAccountChoicePath,
  githubLoginPath,
} from '@/features/auth/login-paths';
import { GitHubSignInLink } from './github-sign-in-link';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const KEY = 'oss-hub-login-destination';

describe('GitHubSignInLink', () => {
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
  function render(props: Omit<Parameters<typeof GitHubSignInLink>[0], 'children'>) {
    act(() =>
      root.render(<GitHubSignInLink {...props}>로그인</GitHubSignInLink>),
    );
  }
  function link() {
    const element = container.querySelector('a');
    if (!element) throw new Error('Expected sign-in link');
    return element;
  }
  function click(init: MouseEventInit = {}) {
    const element = link();
    element.addEventListener('click', (event) => event.preventDefault());
    act(() => {
      element.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
      );
    });
  }

  it('기본 링크는 GitHub 로그인 경로로 이동한다', () => {
    render({ returnTo: null });
    expect(link().getAttribute('href')).toBe(githubLoginPath);
  });
  it('selectAccount는 다른 계정 선택 경로로 이동한다', () => {
    render({ returnTo: null, selectAccount: true });
    expect(link().getAttribute('href')).toBe(githubAccountChoicePath);
  });
  it('일반 왼쪽 클릭은 원래 목적지를 저장한다', () => {
    render({ returnTo: '/programs/42/apply' });
    click();
    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    '새 탭·창 클릭 %j는 목적지를 저장하지 않는다',
    (init) => {
      render({ returnTo: '/programs/42/apply' });
      click(init);
      expect(sessionStorage.getItem(KEY)).toBeNull();
    },
  );
  it.each(['//evil.com', 'javascript:alert(1)', '/signup'])(
    '잘못된 returnTo %s는 아무것도 저장하지 않는다',
    (returnTo) => {
      render({ returnTo });
      click();
      expect(sessionStorage.getItem(KEY)).toBeNull();
    },
  );
  it('returnTo가 없으면 미리 저장된 목적지를 그대로 둔다', () => {
    rememberLoginDestination(sessionStorage, '/programs/42/apply', 0);
    const before = sessionStorage.getItem(KEY);
    render({ returnTo: null });
    click();
    expect(sessionStorage.getItem(KEY)).toBe(before);
  });
  it('나머지 앵커 속성을 그대로 전달한다', () => {
    render({ returnTo: null, className: 'size-4', 'aria-label': 'GitHub으로 로그인' });
    expect(link().getAttribute('class')).toBe('size-4');
    expect(link().getAttribute('aria-label')).toBe('GitHub으로 로그인');
  });
});
