import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
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
  notifyManager.setScheduler(queueMicrotask);
  function render(nextChildren: ReactNode) {
    root.render(
      <QueryClientProvider client={queryClient}>
        {nextChildren}
      </QueryClientProvider>,
    );
  }
  async function rerender(nextChildren: ReactNode) {
    await act(() => Promise.resolve(render(nextChildren)));
  }

  await rerender(children);
  return {
    container,
    queryClient,
    render,
    rerender,
    async unmount() {
      await act(() => Promise.resolve(root.unmount()));
      queryClient.clear();
      container.remove();
      notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    },
  };
}
