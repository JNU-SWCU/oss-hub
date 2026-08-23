// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRoleProvider } from '../../../_shell/session-role-context';
import type { SessionRoleResult } from '../../../_shell/use-session-role';
import type { AppRole } from '../../../_shell/role';
import { ProgramTeamsRouteView } from './program-teams-route-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('@/features/programs/program-teams-page', () => ({
  ProgramTeamsPage: () => <div>학생 팀 구성 화면</div>,
}));
vi.mock('@/features/programs/program-staff-teams-page', () => ({
  ProgramStaffTeamsPage: () => <div>교직원 참여 팀 목록</div>,
}));

function sessionFor(role: AppRole): SessionRoleResult {
  return {
    status: 'assigned',
    memberKind: role === 'ADMIN' ? null : role,
    hasStaffAccess: role === 'STAFF',
    hasAdminAccess: role === 'ADMIN',
    isProfileComplete: true,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    retry: vi.fn(),
  };
}

describe('ProgramTeamsRouteView', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderAs(role: AppRole): void {
    act(() => {
      root.render(
        <SessionRoleProvider value={sessionFor(role)}>
          <ProgramTeamsRouteView programId="program-1" />
        </SessionRoleProvider>,
      );
    });
  }

  it('학생에게는 팀 구성 화면을 준다', () => {
    renderAs('STUDENT');

    expect(container.textContent).toContain('학생 팀 구성 화면');
  });

  // QA33: 사이드바가 교직원에게도 「참여 팀」을 내보내는데 누르면 학생 전용 게이트에
  // 막혀 "접근 권한이 없는 페이지"가 뜨던 것이 이 결함이었다.
  it('교직원 접근이 있으면 참여 팀 목록을 주고 접근 거부 화면을 띄우지 않는다', () => {
    renderAs('STAFF');

    expect(container.textContent).toContain('교직원 참여 팀 목록');
    expect(container.textContent).not.toContain('접근 권한이 없는');
    expect(container.textContent).not.toContain('학생 팀 구성 화면');
  });
});
