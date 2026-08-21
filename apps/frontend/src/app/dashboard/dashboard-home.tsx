'use client';

import { redirect } from 'next/navigation';
import { StudentDashboardScreen } from '@/features/dashboard';
import { StaffDashboardPage } from '@/features/programs/staff-dashboard-page';
import { useSharedSessionRole } from '../_shell/session-role-context';

/**
 * 회원 공통 `/dashboard` 본문 — 세션 역할에 따라 화면만 갈린다.
 *
 * 역할 SoT는 로그인 JWT가 아니라 DB `User.role`이다. 쿠키 세션(githubId)으로
 * `/auth/session`이 사용자를 읽고, `RoleGate`가 물려 준 스냅샷(`useSharedSessionRole`)을
 * 그대로 쓴다. 게이트를 다시 호출하지 않는다.
 *
 * ADMIN은 교직원 업무까지 수행하므로 STAFF와 같은 운영 대시보드를 본다.
 * 관리 도구는 `/admin/*` 라우트만 담당한다.
 *
 * 이 컴포넌트는 `allow={STUDENT|STAFF|ADMIN}` 게이트 안에서만 마운트된다.
 * 비회원·미완료 가입자는 여기까지 오지 않으므로 AccessDenied를 그리지 않는다.
 */
export function DashboardHome() {
  const { memberKind, hasStaffAccess, hasAdminAccess } = useSharedSessionRole();

  if (hasStaffAccess) return <StaffDashboardPage />;
  if (memberKind === 'STUDENT') return <StudentDashboardScreen />;
  if (hasAdminAccess) redirect('/admin/access');
  return null;
}
