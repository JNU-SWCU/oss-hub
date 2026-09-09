// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rememberLoginDestination,
  takeLoginDestination,
} from '@/features/auth/login-destination';
import {
  githubAccountChoicePath,
  githubLoginPath,
} from '@/features/auth/login-paths';
import { SignupInviteView } from './signup-entry-screen';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('로그인 시작 버튼의 원래 목적지 보존', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(window.location, 'search', 'get').mockReturnValue(
      '?returnTo=%2Fprograms%2F42%2Fapply',
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<SignupInviteView />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  function click(path: string, init: MouseEventInit = {}) {
    const link = container.querySelector<HTMLAnchorElement>(
      `a[href="${path}"]`,
    );
    if (!link) throw new Error('Expected OAuth link');
    link.addEventListener('click', (event) => event.preventDefault());
    act(() =>
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
      ),
    );
  }
  it.each([githubLoginPath, githubAccountChoicePath])(
    '%s로 나가기 전에 같은 탭의 목적지를 저장한다',
    (path) => {
      click(path);
      expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
    },
  );
  it('저장소 getter가 실패해도 로그인 클릭을 처리할 수 있다', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    expect(() => click(githubLoginPath)).not.toThrow();
  });
  it('OAuth 실패 뒤 목적지 없는 가입 화면에서 재시도해도 원래 목적지를 유지한다', () => {
    rememberLoginDestination(sessionStorage, '/programs/42/apply', 0);
    vi.spyOn(Date, 'now').mockReturnValue(300000);
    vi.spyOn(window.location, 'search', 'get').mockReturnValue('');
    click(githubLoginPath);
    expect(takeLoginDestination(sessionStorage, 300001)).toBe(
      '/programs/42/apply',
    );
  });
  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }])(
    '새 탭·창 클릭 %j는 원래 탭에 복귀 요청을 남기지 않는다',
    (init) => {
      click(githubLoginPath, init);
      expect(takeLoginDestination(sessionStorage)).toBeNull();
    },
  );
});
