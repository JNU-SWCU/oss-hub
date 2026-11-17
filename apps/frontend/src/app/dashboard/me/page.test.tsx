import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberSurface } from '../../_shell/member-access';
import { RolePanelShell } from '../../_shell/role-panel-shell';
import type { SessionRoleResult } from '../../_shell/use-session-role';
import { DASHBOARD_ALLOWED_SURFACES } from '../dashboard-access';

const mocks = vi.hoisted(() => ({ useSessionRole: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/me',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('../../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

vi.mock('@/features/profile/components/my-profile-screen', () => ({
  MyProfileScreen: () => <div data-testid="my-profile-screen" />,
}));

import MyProfilePage from './page';

function session(overrides: Partial<SessionRoleResult>): SessionRoleResult {
  return {
    status: 'assigned',
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: true,
    retry: () => {},
    ...overrides,
  };
}

describe('내 정보 라우트', () => {
  beforeEach(() => mocks.useSessionRole.mockReset());

  it('게이트에 넘기는 허용 역할이 회원 공통 입구 계약과 같다', () => {
    const gate = MyProfilePage() as ReactElement<{
      readonly allow: readonly MemberSurface[];
      readonly deniedPath?: string;
    }>;

    expect(gate.type).toBe(RolePanelShell);
    expect(gate.props.allow).toBe(DASHBOARD_ALLOWED_SURFACES);
    expect(gate.props.deniedPath).toBeUndefined();
  });

  it.each([
    ['학생', { memberKind: 'STUDENT' }],
    ['교직원', { memberKind: 'STAFF', hasStaffAccess: true }],
    ['관리자 단독', { hasAdminAccess: true }],
  ] satisfies [string, Partial<SessionRoleResult>][])(
    '%s 세션에 내 정보 화면을 연다',
    (_, access) => {
      mocks.useSessionRole.mockReturnValue(session(access));

      const html = renderToStaticMarkup(<MyProfilePage />);

      expect(html).toContain('data-testid="my-profile-screen"');
      expect(html).not.toContain('접근 권한이 없습니다');
    },
  );

  it('비로그인 사용자에게는 다른 대시보드 화면처럼 로그인 안내를 보여 준다', () => {
    mocks.useSessionRole.mockReturnValue(session({ status: 'anonymous' }));

    const html = renderToStaticMarkup(<MyProfilePage />);

    expect(html).toContain('로그인이 필요합니다');
    expect(html).not.toContain('data-testid="my-profile-screen"');
  });

  it('권한이 없는 교직원 회원에게는 화면을 열지 않는다', () => {
    mocks.useSessionRole.mockReturnValue(session({ memberKind: 'STAFF' }));

    const html = renderToStaticMarkup(<MyProfilePage />);

    expect(html).toContain('접근 권한이 없습니다');
    expect(html).not.toContain('data-testid="my-profile-screen"');
  });
});
