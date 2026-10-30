'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { NoticeStorage } from './signup-completion-notice';

type NavigationNotices =
  | { readonly status: 'pending' }
  | {
      readonly status: 'ready';
      readonly loggedOut: boolean;
      readonly purgeSummary: string | null;
    };

const PENDING: NavigationNotices = { status: 'pending' };
const EMPTY = { status: 'ready', loggedOut: false, purgeSummary: null } satisfies NavigationNotices;
const LOGGED_OUT_KEY = 'oss-hub-logged-out';
const PURGED_KEY = 'oss-hub-program-purged';
const NavigationNoticeContext = createContext<NavigationNotices>(PENDING);

function browserStorage(): NoticeStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    browserStorage()?.setItem(key, value);
  } catch {
    return;
  }
}

export function rememberLoggedOut(): void {
  remember(LOGGED_OUT_KEY, '/');
}

export function rememberProgramPurged(summary: string): void {
  remember(PURGED_KEY, JSON.stringify({ destination: '/programs', summary }));
}

function take(pathname: string): NavigationNotices {
  const storage = browserStorage();
  if (!storage) return EMPTY;
  try {
    if (pathname === '/') {
      const value = storage.getItem(LOGGED_OUT_KEY);
      storage.removeItem(LOGGED_OUT_KEY);
      return { ...EMPTY, loggedOut: value === '/' };
    }
    if (pathname === '/programs') {
      const raw = storage.getItem(PURGED_KEY);
      storage.removeItem(PURGED_KEY);
      const value: unknown = raw === null ? null : JSON.parse(raw);
      if (
        typeof value === 'object' && value !== null &&
        'destination' in value && value.destination === '/programs' &&
        'summary' in value && typeof value.summary === 'string'
      ) {
        return { ...EMPTY, purgeSummary: value.summary };
      }
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

export function NavigationNoticeProvider({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const snapshot = useRef<{ readonly pathname: string; readonly notices: NavigationNotices } | null>(null);
  const [resolved, setResolved] = useState<typeof snapshot.current>(null);

  useEffect(() => {
    if (snapshot.current?.pathname !== pathname) {
      snapshot.current = { pathname, notices: take(pathname) };
    }
    setResolved(snapshot.current);
  }, [pathname]);

  return (
    <NavigationNoticeContext.Provider value={resolved?.pathname === pathname ? resolved.notices : PENDING}>
      {children}
    </NavigationNoticeContext.Provider>
  );
}

export function useNavigationNotices(): NavigationNotices {
  return useContext(NavigationNoticeContext);
}
