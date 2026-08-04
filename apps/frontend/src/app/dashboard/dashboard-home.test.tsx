import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionRoleResult } from '../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  useSharedSessionRole: vi.fn(),
}));

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

vi.mock('@/features/roles/components/admin-access-screen', () => ({
  AdminAccessScreen: () => <div data-testid="admin-access">관리 콘솔</div>,
}));

import { DashboardHome } from './dashboard-home';

function session(role: 'STUDENT' | 'STAFF' | 'ADMIN'): SessionRoleResult {
  return {
    status: 'assigned',
    role,
    roleRequestStatus: null,
    selectedRole: null,
    isProfileComplete: true,
    retry: () => {},
  };
}

describe('DashboardHome', () => {
  it('STUDENT 세션이면 학생 대시보드 본문을 그린다', () => {
    mocks.useSharedSessionRole.mockReturnValue(session('STUDENT'));
    const html = renderToStaticMarkup(<DashboardHome />);
    expect(html).toContain('data-testid="student-dashboard"');
    expect(html).not.toContain('data-testid="staff-dashboard"');
    expect(html).not.toContain('data-testid="admin-access"');
  });

  it('STAFF 세션이면 운영 대시보드 본문을 그린다', () => {
    mocks.useSharedSessionRole.mockReturnValue(session('STAFF'));
    const html = renderToStaticMarkup(<DashboardHome />);
    expect(html).toContain('data-testid="staff-dashboard"');
    expect(html).not.toContain('data-testid="student-dashboard"');
  });

  it('ADMIN 세션이면 관리 콘솔 본문을 그린다', () => {
    mocks.useSharedSessionRole.mockReturnValue(session('ADMIN'));
    const html = renderToStaticMarkup(<DashboardHome />);
    expect(html).toContain('data-testid="admin-access"');
    expect(html).not.toContain('data-testid="student-dashboard"');
  });
});
