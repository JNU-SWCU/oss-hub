import { describe, expect, it } from 'vitest';

import { PENDING_PROFILE_EDIT_PATH } from '@/features/roles/components/role-request-screen';

import { isSettingsOpenForStaffAwaitingRole } from '../../settings/settings-access';
import type { SessionRoleState } from '../../_shell/use-session-role';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'unassigned',
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    staffAccessRequestStatus: null,
    staffAccessRequestRejectionReason: null,
    selectedRole: null,
    isProfileComplete: false,
    ...overrides,
  };
}

describe('승인 대기 화면이 가리키는 프로필 수정 경로', () => {
  it('설정 화면을 가리킨다', () => {
    expect(PENDING_PROFILE_EDIT_PATH).toBe('/settings');
  });

  it.each(['PENDING', 'APPROVED'] as const)(
    '링크를 내주는 %s 교직원에게 그 화면이 열려 있다',
    (staffAccessRequestStatus) => {
      const awaiting = state({ staffAccessRequestStatus });

      expect(isSettingsOpenForStaffAwaitingRole(awaiting)).toBe(true);
    },
  );

  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 상태에는 그 화면이 닫혀 있다 — 그래서 링크도 그리지 않는다',
    (staffAccessRequestStatus) => {
      const closed = state({ staffAccessRequestStatus });

      expect(isSettingsOpenForStaffAwaitingRole(closed)).toBe(false);
    },
  );
});
