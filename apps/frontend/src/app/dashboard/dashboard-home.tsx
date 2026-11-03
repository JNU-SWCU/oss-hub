'use client';

import { redirect } from 'next/navigation';
import { StudentDashboardScreen } from '@/features/dashboard';
import { StaffDashboardPage } from '@/features/programs/staff-dashboard/staff-dashboard-page';
import { useSharedSessionRole } from '../_shell/session-role-context';
import { hasStaffAudience } from '../_shell/member-access';

export function DashboardHome() {
  const session = useSharedSessionRole();

  if (hasStaffAudience(session)) return <StaffDashboardPage />;
  if (session.memberKind === 'STUDENT') return <StudentDashboardScreen />;
  if (session.hasAdminAccess) redirect('/dashboard/users');
  return null;
}
