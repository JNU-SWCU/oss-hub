import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rememberLoginDestination,
  takeLoginDestination,
} from '@/features/auth/login-destination';
import {
  githubAccountChoicePath,
  githubLoginPath,
} from '@/features/auth/login-paths';
import { SignupEntryView, SignupInviteView } from './signup-entry-screen';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('로그인 화면의 이동 선택', () => {
  it('이어서 진행할 사용자는 로그인 링크 대신 이동 링크를 본다', () => {
    const html = renderToStaticMarkup(
      <SignupEntryView
        decision={{ kind: 'resume', href: '/dashboard', label: '대시보드' }}
      />,
    );

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('이어서 진행합니다');
    expect(html).not.toContain('href="/api/v1/auth/github"');
  });
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
    act(() => {
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
      );
    });
  }
  it.each([githubLoginPath, githubAccountChoicePath])(
    '%s로 나가기 전에 같은 탭의 목적지를 저장한다',
    (path) => {
      click(path);
      expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
    },
  );
  function remount(search: string) {
    act(() => root.unmount());
    sessionStorage.clear();
    vi.spyOn(window.location, 'search', 'get').mockReturnValue(search);
    root = createRoot(container);
    act(() => root.render(<SignupInviteView />));
  }
  it.each(['?returnTo=%2F%2Fevil.com', '?returnTo=%2Fapi%2Fv1%2Fauth'])(
    '외부·내부 보호 경로 %s는 저장하지 않는다',
    (search) => {
      remount(search);

      click(githubLoginPath);

      expect(sessionStorage.getItem('oss-hub-login-destination')).toBeNull();
    },
  );
  it('마운트 이후에 정해진 목적지를 클릭 시점에 읽지 않는다', () => {
    vi.spyOn(window.location, 'search', 'get').mockReturnValue(
      '?returnTo=%2Fprograms%2F99',
    );

    click(githubLoginPath);

    expect(takeLoginDestination(sessionStorage)).toBe('/programs/42/apply');
  });
  it('저장소 getter가 실패해도 로그인 클릭을 처리할 수 있다', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    expect(() => click(githubLoginPath)).not.toThrow();
  });
  it('returnTo 없이 마운트되면 클릭해도 지난 복귀 요청을 지우지 않는다', () => {
    remount('');
    rememberLoginDestination(sessionStorage, '/programs/42/apply', 0);
    const storedRaw = sessionStorage.getItem('oss-hub-login-destination');

    click(githubLoginPath);

    expect(sessionStorage.getItem('oss-hub-login-destination')).toBe(storedRaw);
    expect(takeLoginDestination(sessionStorage, 300001)).toBe(
      '/programs/42/apply',
    );
  });
  it('빈 저장소에서 returnTo 없이 마운트되면 아무것도 저장하지 않는다', () => {
    remount('');

    click(githubLoginPath);

    expect(sessionStorage.getItem('oss-hub-login-destination')).toBeNull();
  });
  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }])(
    '새 탭·창 클릭 %j는 원래 탭에 복귀 요청을 남기지 않는다',
    (init) => {
      click(githubLoginPath, init);
      expect(takeLoginDestination(sessionStorage)).toBeNull();
    },
  );
});
