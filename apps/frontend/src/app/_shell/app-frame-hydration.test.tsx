import { QueryClientProvider } from '@tanstack/react-query';
import { act, Suspense, use, useLayoutEffect } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../../test-support/render-with-query';
import type { AuthSession } from '@/features/auth/types';

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn<() => Promise<AuthSession>>(),
  replace: vi.fn(),
}));

vi.mock('@/features/auth/api', () => ({
  fetchSession: () => mocks.fetchSession(),
}));
vi.mock('@/features/consents/queries', () => ({
  useCurrentConsentQuery: () => ({
    data: {
      policyVersion: '2026-11-01',
      acceptedPolicyVersion: '2026-11-01',
      consented: true,
    },
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('./use-product-shell-data', () => ({
  useProductShellData: () => ({
    facetData: undefined,
    facetStatus: 'idle',
    scopeOverview: undefined,
    scopeOverviewStatus: 'idle',
    scopeMilestones: undefined,
    scopeParticipant: undefined,
    scopeViewerRole: null,
    scopeViewReady: false,
  }),
}));

import {
  getSessionSnapshot,
  resetSessionStore,
  subscribeSession,
} from '@/features/auth/session-store';
import { AppFrame } from './app-frame';
import { RoleGate } from './role-gate';

const ASSIGNED_SESSION: AuthSession = {
  isAuthenticated: true,
  user: {
    nickname: 'hydration-user',
    name: 'Hydration User',
    email: null,
    avatarUrl: null,
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          1_000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

let suspendRoute = false;
let routeGate = deferred<void>();
let routeCommitted = deferred<void>();

function HydratedSettings() {
  useLayoutEffect(() => routeCommitted.resolve(), []);
  return <div data-testid="hydrated-settings">설정 본문</div>;
}

function SettingsRouteBoundary() {
  if (suspendRoute) use(routeGate.promise);
  return (
    <RoleGate allow={['student']}>
      <HydratedSettings />
    </RoleGate>
  );
}

function TestScreen() {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <AppFrame brand="OSS Hub">
        <Suspense fallback={null}>
          <SettingsRouteBoundary />
        </Suspense>
      </AppFrame>
    </QueryClientProvider>
  );
}

describe('AppFrame 선택적 hydration', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    resetSessionStore();
    mocks.fetchSession.mockReset();
    mocks.replace.mockReset();
    suspendRoute = false;
    routeGate = deferred<void>();
    routeCommitted = deferred<void>();
    container = document.createElement('div');
    document.body.append(container);
    root = null;
  });

  afterEach(async () => {
    suspendRoute = false;
    routeGate.resolve();
    if (root !== null) await act(async () => root?.unmount());
    container.remove();
    resetSessionStore();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('빠른 세션 응답이 늦은 route boundary보다 먼저 와도 서버 loading 트리를 유지한다', async () => {
    const session = deferred<AuthSession>();
    const fetchStarted = deferred<void>();
    mocks.fetchSession.mockImplementation(() => {
      fetchStarted.resolve();
      return session.promise;
    });
    const screen = <TestScreen />;
    container.innerHTML = renderToString(screen);
    expect(container.textContent).toContain('확인 중…');
    suspendRoute = true;
    const recoverableErrors: unknown[] = [];
    root = hydrateRoot(container, screen, {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });

    await withTimeout(fetchStarted.promise, 'session request');
    expect(mocks.fetchSession).toHaveBeenCalledOnce();

    const sessionPublished = deferred<void>();
    const unsubscribe = subscribeSession(() => {
      if (getSessionSnapshot().status === 'authenticated') {
        sessionPublished.resolve();
      }
    });
    await act(async () => session.resolve(ASSIGNED_SESSION));
    await withTimeout(sessionPublished.promise, 'authenticated session');
    unsubscribe();

    await act(async () => {
      suspendRoute = false;
      routeGate.resolve();
    });
    await withTimeout(routeCommitted.promise, 'settings route commit');

    expect(
      container.querySelector('[data-testid="hydrated-settings"]'),
    ).not.toBeNull();
    expect(recoverableErrors).toEqual([]);
  });
});
