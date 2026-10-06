'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { SessionError } from './session-error';
import { useSessionRole } from './use-session-role';

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, retry } = useSessionRole();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/');
    }
  }, [status, router]);

  if (status === 'error') {
    return <SessionError onRetry={retry} />;
  }

  if (status === 'loading' || status === 'anonymous') {
    return (
      <p
        className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
        role="status"
      >
        확인 중…
      </p>
    );
  }

  return <>{children}</>;
}
