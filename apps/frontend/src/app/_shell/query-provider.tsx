'use client';

import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { useSession } from '@/features/auth/use-session';
import { subscribeSessionInvalidation } from '@/lib/session-invalidation';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 0,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (environmentManager.isServer()) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = getQueryClient();
  const session = useSession();
  useEffect(() => subscribeSessionInvalidation(session.retry), [session.retry]);
  const identity =
    session.status === 'anonymous'
      ? null
      : session.status === 'authenticated' && session.user !== null
        ? JSON.stringify([
            session.user.nickname,
            session.user.memberKind,
            session.user.hasStaffAccess,
            session.user.hasAdminAccess,
          ])
        : undefined;
  const previousIdentity = useRef<string | null | undefined>(undefined);
  const nickname =
    session.status === 'authenticated' ? session.user?.nickname : undefined;
  const previousNickname = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (identity === undefined) return;
    if (
      previousIdentity.current !== undefined &&
      previousIdentity.current !== identity
    ) {
      if (nickname !== undefined && previousNickname.current === nickname) {
        queryClient.removeQueries({ type: 'inactive' });
        queryClient.getMutationCache().clear();
        void queryClient.resetQueries({ type: 'active' });
      } else {
        queryClient.clear();
      }
    }
    previousIdentity.current = identity;
    previousNickname.current = nickname;
  }, [identity, nickname, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
