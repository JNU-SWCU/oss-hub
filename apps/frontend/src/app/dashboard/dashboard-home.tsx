'use client';

import { Suspense } from 'react';
import { StudentDashboardScreen } from '@/features/dashboard';
import { StaffDashboardPage } from '@/features/programs/staff-dashboard-page';
import { AdminAccessScreen } from '@/features/roles/components/admin-access-screen';
import { useSharedSessionRole } from '../_shell/session-role-context';

/**
 * 회원 공통 `/dashboard` 본문 — 세션 역할에 따라 화면만 갈린다.
 *
 * 역할 SoT는 로그인 JWT가 아니라 DB `User.role`이다. 쿠키 세션(githubId)으로
 * `/auth/me`가 사용자를 읽고, `RoleGate`가 물려 준 스냅샷(`useSharedSessionRole`)을
 * 그대로 쓴다. 게이트를 다시 호출하지 않는다.
 *
 * 이 컴포넌트는 `allow={STUDENT|STAFF|ADMIN}` 게이트 안에서만 마운트된다.
 * 비회원·미완료 가입자는 여기까지 오지 않으므로 AccessDenied를 그리지 않는다.
 */
export function DashboardHome() {
  const { role } = useSharedSessionRole();

  switch (role) {
    case 'STAFF':
      return <StaffDashboardPage />;
    case 'ADMIN':
      // AdminAccessScreen은 searchParams를 읽는다 — /admin/access와 동일하게
      // Suspense 경계가 필요하다. 행 soft-nav 모달 intercept는 /admin/access 트리에
      // 남아 있어, 상세는 하드 경로(`/admin/access/users/:id`)로 열린다.
      return (
        <Suspense fallback={null}>
          <AdminAccessScreen />
        </Suspense>
      );
    case 'STUDENT':
      return <StudentDashboardScreen />;
    case null:
      // RoleGate allow 통과 뒤에만 마운트된다. null이면 게이트 조합 오류다.
      return null;
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}
