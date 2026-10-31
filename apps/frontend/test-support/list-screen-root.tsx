import { createRoot } from 'react-dom/client';
import { StrictMode, isValidElement, useSyncExternalStore } from 'react';
import { QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { beforeEach } from 'vitest';
import { createTestQueryClient } from './render-with-query';

const listeners = new Set<() => void>();
let currentSearch = '';
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => currentSearch;

export const listNavigation = {
  get search() {
    return currentSearch;
  },
  set search(next: string) {
    currentSearch = next;
    for (const listener of listeners) listener();
  },
  push(href: string) {
    listNavigation.search = href.split('?')[1] ?? '';
  },
  replace(href: string) {
    listNavigation.search = href.split('?')[1] ?? '';
  },
};

export function useTestSearchParams() {
  return new URLSearchParams(
    useSyncExternalStore(subscribe, snapshot, snapshot),
  );
}

beforeEach(() => {
  listNavigation.search = '';
});

export function createListScreenRoot(container: Element | DocumentFragment) {
  const root = createRoot(container);
  const queryClient = createTestQueryClient();
  notifyManager.setScheduler(queueMicrotask);
  return {
    queryClient,
    render(children: React.ReactNode) {
      const tree = (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
      root.render(
        isValidElement(children) && children.type === StrictMode ? (
          <StrictMode>{tree}</StrictMode>
        ) : (
          tree
        ),
      );
    },
    unmount() {
      root.unmount();
      queryClient.clear();
      notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    },
  };
}
