'use client';

import { redirect } from 'next/navigation';
import { StudentDashboardScreen } from '@/features/dashboard';
import { StaffDashboardPage } from '@/features/programs/staff-dashboard-page';
import { useSharedSessionRole } from '../_shell/session-role-context';

export function DashboardHome() {
  const { memberKind, hasStaffAccess, hasAdminAccess } = useSharedSessionRole();

  if (hasStaffAccess) return <StaffDashboardPage />;
  if (memberKind === 'STUDENT') return <StudentDashboardScreen />;
  if (hasAdminAccess) redirect('/dashboard/users');
  return null;
}
