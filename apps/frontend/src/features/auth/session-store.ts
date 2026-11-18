'use client';

import { fetchSession } from './api';
import { ApiError } from '@/lib/api-client';
import type { Me } from './types';

type AuthSessionStatus = 'loading' | 'error' | 'anonymous' | 'authenticated';

export interface AuthSessionState {
  readonly status: AuthSessionStatus;
  readonly user: Me | null;
}

const LOADING_STATE: AuthSessionState = { status: 'loading', user: null };
const ERROR_STATE: AuthSessionState = { status: 'error', user: null };
const ANONYMOUS_STATE: AuthSessionState = { status: 'anonymous', user: null };

let snapshot: AuthSessionState = LOADING_STATE;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let generation = 0;
let lifecycleInstalled = false;

function publish(next: AuthSessionState): void {
  snapshot = next;
  for (const listener of [...listeners]) {
    listener();
  }
}

async function load(loadGeneration: number): Promise<void> {
  try {
    const session = await fetchSession();
    if (loadGeneration !== generation) return;
    if (!session.isAuthenticated) {
      publish(ANONYMOUS_STATE);
      return;
    }

    publish({ status: 'authenticated', user: session.user });
  } catch (error: unknown) {
    if (loadGeneration !== generation) return;
    if (error instanceof ApiError && error.problem.status === 401) {
      publish(ANONYMOUS_STATE);
      return;
    }

    publish(ERROR_STATE);
  }
}

function startSessionLoad(): void {
  const request = load(generation).finally(() => {
    if (inFlight === request) {
      inFlight = null;
    }
  });
  inFlight = request;
}

function revalidateSession(): void {
  generation += 1;
  inFlight = null;
  startSessionLoad();
}

function installSessionLifecycle(): void {
  if (lifecycleInstalled || typeof window === 'undefined') return;
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) revalidateSession();
  });
  lifecycleInstalled = true;
}

export function ensureSessionLoaded(): void {
  installSessionLifecycle();
  if (inFlight !== null || snapshot.status !== 'loading') {
    return;
  }
  startSessionLoad();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionSnapshot(): AuthSessionState {
  return snapshot;
}

export function getSessionServerSnapshot(): AuthSessionState {
  return LOADING_STATE;
}

export function refreshSession(): void {
  generation += 1;
  inFlight = null;
  publish(LOADING_STATE);
  ensureSessionLoaded();
}

export function resetSessionStore(): void {
  generation += 1;
  inFlight = null;
  snapshot = LOADING_STATE;
  listeners.clear();
}
