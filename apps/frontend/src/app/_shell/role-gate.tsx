'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { onboardingPathFor } from './onboarding-route';
import { useSessionRole } from './use-session-role';
import { roleHomePath, type AppRole } from './role';

/**
 * 클라이언트 사이드 역할 게이트 (#136 최소 요구 4) — redirect까지만 담당한다.
 * - 비로그인: 로그인 유도(랜딩 `/`)로 이동.
 * - 로그인했지만 역할 미확정: `/onboarding/role`(#107)로 이동.
 * - 역할은 확정됐지만 `allow`에 없음: 자기 역할 홈으로 이동.
 * 서버 사이드 강화(middleware)는 이 티켓 범위 밖이다.
 */
export function RoleGate({
  allow,
  children,
}: {
  allow: AppRole[];
  children: ReactNode;
}) {
  const router = useRouter();
  const { status, role, roleRequestStatus } = useSessionRole();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/');
      return;
    }
    if (status === 'unassigned') {
      router.replace(onboardingPathFor(roleRequestStatus));
      return;
    }
    if (status === 'assigned' && role && !allow.includes(role)) {
      router.replace(roleHomePath(role));
    }
  }, [status, role, roleRequestStatus, allow, router]);

  const isAllowed = status === 'assigned' && !!role && allow.includes(role);

  if (!isAllowed) {
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        확인 중…
      </p>
    );
  }

  return <>{children}</>;
}
