import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionRoleResult } from '../_shell/use-session-role';

const mocks = vi.hoisted(() => ({
  useSessionRole: vi.fn(),
}));

vi.mock('../_shell/use-session-role', () => ({
  useSessionRole: mocks.useSessionRole,
}));

vi.mock('@/features/programs/program-list-page', () => ({
  ProgramListPage: ({
    canCreateProgram,
    viewerRole,
  }: {
    readonly canCreateProgram: boolean;
    readonly viewerRole: string | null;
  }) => (
    <div
      data-can-create={String(canCreateProgram)}
      data-viewer-role={viewerRole ?? 'none'}
    />
  ),
}));

import ProgramsPage from './page';

function assigned(
  memberKind: 'STUDENT' | 'STAFF' | null,
  hasStaffAccess: boolean,
  hasAdminAccess: boolean,
  isProfileComplete: boolean,
): SessionRoleResult {
  return {
    status: 'assigned',
    role: hasAdminAccess ? 'ADMIN' : hasStaffAccess ? 'STAFF' : 'STUDENT',
    memberKind,
    hasStaffAccess,
    hasAdminAccess,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete,
    retry: () => {},
  };
}

function renderedCapability(
  memberKind: 'STUDENT' | 'STAFF' | null,
  hasStaffAccess: boolean,
  hasAdminAccess: boolean,
  isProfileComplete: boolean,
): string {
  mocks.useSessionRole.mockReturnValue(
    assigned(memberKind, hasStaffAccess, hasAdminAccess, isProfileComplete),
  );
  return renderToStaticMarkup(<ProgramsPage />);
}

describe('ProgramsPage 생성 capability', () => {
  it('staff-admin은 staff access로 생성 동선을 쓴다', () => {
    expect(renderedCapability('STAFF', true, true, true)).toContain(
      'data-can-create="true"',
    );
    expect(renderedCapability('STAFF', true, true, false)).toContain(
      'data-can-create="false"',
    );
  });

  it('프로필을 마친 학생에게도 생성 동선을 열지 않는다', () => {
    const html = renderedCapability('STUDENT', false, true, true);

    expect(html).toContain('data-can-create="false"');
    expect(html).toContain('data-viewer-role="STUDENT"');
  });
});
