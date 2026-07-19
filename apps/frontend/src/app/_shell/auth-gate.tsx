'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRole } from './use-session-role';

/**
 * 로그인만 요구하는 공통 온보딩 스텁용 게이트(#99·#107) — 역할 확정 여부는
 * 따지지 않는다. 비로그인 사용자만 로그인 유도(랜딩 `/`)로 되돌린다.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status } = useSessionRole();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'anonymous') {
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        확인 중…
      </p>
    );
  }

  return <>{children}</>;
}
