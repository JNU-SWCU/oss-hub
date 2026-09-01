import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionRoleResult } from '../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  useSharedSessionRole: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

vi.mock('../_shell/session-role-context', () => ({
  useSharedSessionRole: mocks.useSharedSessionRole,
}));

vi.mock('@/features/dashboard', () => ({
  StudentDashboardScreen: () => (
    <div data-testid="student-dashboard">학생 대시보드</div>
  ),
}));

vi.mock('@/features/programs/staff-dashboard-page', () => ({
  StaffDashboardPage: () => (
    <div data-testid="staff-dashboard">운영 대시보드</div>
  ),
}));

import { DashboardHome } from './dashboard-home';

function session(
  memberKind: 'STUDENT' | 'STAFF' | null,
  hasStaffAccess: boolean,
  hasAdminAccess: boolean,
): SessionRoleResult {
  return {
    status: 'assigned',
    memberKind,
    hasStaffAccess,
    hasAdminAccess,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: true,
    retry: () => {},
  };
}

describe('DashboardHome', () => {
  it('STUDENT 세션이면 학생 대시보드 본문을 그린다', () => {
    mocks.useSharedSessionRole.mockReturnValue(session('STUDENT', false, true));
    const html = renderToStaticMarkup(<DashboardHome />);
    expect(html).toContain('data-testid="student-dashboard"');
    expect(html).not.toContain('data-testid="staff-dashboard"');
  });

  it('STAFF 세션이면 운영 대시보드 본문을 그린다', () => {
    mocks.useSharedSessionRole.mockReturnValue(session('STAFF', true, true));
    const html = renderToStaticMarkup(<DashboardHome />);
    expect(html).toContain('data-testid="staff-dashboard"');
    expect(html).not.toContain('data-testid="student-dashboard"');
  });

  it('admin-only compatibility는 교직원 본문 대신 관리자 화면으로 보낸다', () => {
    mocks.useSharedSessionRole.mockReturnValue(session(null, false, true));
    renderToStaticMarkup(<DashboardHome />);
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard/users');
  });
});
