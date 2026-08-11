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
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
  isProfileComplete: boolean,
): SessionRoleResult {
  return {
    status: 'assigned',
    role,
    roleRequestStatus: null,
    roleRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete,
    retry: () => {},
  };
}

function renderedCapability(
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
  isProfileComplete: boolean,
): string {
  mocks.useSessionRole.mockReturnValue(assigned(role, isProfileComplete));
  return renderToStaticMarkup(<ProgramsPage />);
}

describe('ProgramsPage 생성 capability', () => {
  it.each(['STAFF', 'ADMIN'] as const)(
    '프로필을 마친 %s에게만 생성 동선을 연다',
    (role) => {
      expect(renderedCapability(role, true)).toContain(
        'data-can-create="true"',
      );
      expect(renderedCapability(role, false)).toContain(
        'data-can-create="false"',
      );
    },
  );

  it('프로필을 마친 학생에게도 생성 동선을 열지 않는다', () => {
    const html = renderedCapability('STUDENT', true);

    expect(html).toContain('data-can-create="false"');
    expect(html).toContain('data-viewer-role="STUDENT"');
  });
});
