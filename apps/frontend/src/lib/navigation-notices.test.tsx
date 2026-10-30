import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NavigationNoticeProvider,
  rememberLoggedOut,
  rememberProgramPurged,
  useNavigationNotices,
} from './navigation-notices';

const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function Reader() {
  const notice = useNavigationNotices();
  return <output>{JSON.stringify(notice)}</output>;
}

describe('navigation notices', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    sessionStorage.clear();
    navigation.pathname = '/';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render() {
    await act(async () => {
      root.render(
        <StrictMode>
          <NavigationNoticeProvider>
            <Reader />
            <Reader />
          </NavigationNoticeProvider>
        </StrictMode>,
      );
    });
  }

  it('starts pending on the server', () => {
    expect(
      renderToString(
        <NavigationNoticeProvider>
          <Reader />
        </NavigationNoticeProvider>,
      ),
    ).toContain('pending');
  });

  it('shares one logout snapshot across readers and StrictMode effects', async () => {
    rememberLoggedOut();
    await render();
    for (const reader of container.querySelectorAll('output')) {
      expect(JSON.parse(reader.textContent ?? '')).toEqual({
        status: 'ready',
        loggedOut: true,
        purgeSummary: null,
      });
    }
    expect(sessionStorage.getItem('oss-hub-logged-out')).toBeNull();
  });

  it('consumes a purge ticket only on arrival and never replays it on back', async () => {
    navigation.pathname = '/programs/42/edit';
    rememberProgramPurged('지원서 2건');
    await render();
    expect(sessionStorage.getItem('oss-hub-program-purged')).not.toBeNull();
    navigation.pathname = '/programs';
    await render();
    expect(container.textContent).toContain('지원서 2건');
    navigation.pathname = '/ranking';
    await render();
    navigation.pathname = '/programs';
    await render();
    expect(container.textContent).not.toContain('지원서 2건');
  });

  it('does not replay a consumed logout ticket after remount', async () => {
    rememberLoggedOut();
    await render();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).not.toContain('"loggedOut":true');
  });

  it.each(['getItem', 'setItem', 'removeItem'] as const)(
    'storage %s failure does not block either notice flow',
    async (method) => {
      vi.spyOn(sessionStorage, method).mockImplementation(() => {
        throw new DOMException('Blocked', 'SecurityError');
      });
      expect(() => rememberLoggedOut()).not.toThrow();
      expect(() => rememberProgramPurged('지원서 2건')).not.toThrow();
      await render();
      navigation.pathname = '/programs';
      await render();
      expect(container.textContent).toContain('"status":"ready"');
      expect(container.textContent).not.toContain('지원서 2건');
    },
  );

  it('ignores malformed storage values', async () => {
    sessionStorage.setItem('oss-hub-logged-out', '/ranking');
    sessionStorage.setItem('oss-hub-program-purged', '{');
    await render();
    expect(container.textContent).not.toContain('"loggedOut":true');
    navigation.pathname = '/programs';
    await render();
    expect(container.textContent).toContain('"purgeSummary":null');
  });
});
