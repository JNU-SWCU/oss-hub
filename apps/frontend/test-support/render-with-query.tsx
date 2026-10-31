import { act, StrictMode, isValidElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  QueryClient,
  QueryClientProvider,
  notifyManager,
} from '@tanstack/react-query';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0,
        gcTime: 0,
      },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

export function createQueryRoot(
  container: Element | DocumentFragment,
  options?: Parameters<typeof createRoot>[1],
) {
  const root = createRoot(container, options);
  const queryClient = createTestQueryClient();
  notifyManager.setScheduler(queueMicrotask);
  return {
    queryClient,
    render(children: ReactNode) {
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

export async function renderWithQuery(
  children: ReactNode,
  {
    queryClient = createTestQueryClient(),
  }: { readonly queryClient?: QueryClient } = {},
) {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  async function rerender(nextChildren: ReactNode) {
    await act(() =>
      Promise.resolve(
        root.render(
          <QueryClientProvider client={queryClient}>
            {nextChildren}
          </QueryClientProvider>,
        ),
      ),
    );
  }

  await rerender(children);
  return {
    container,
    queryClient,
    rerender,
    async unmount() {
      await act(() => Promise.resolve(root.unmount()));
      queryClient.clear();
      container.remove();
    },
  };
}
