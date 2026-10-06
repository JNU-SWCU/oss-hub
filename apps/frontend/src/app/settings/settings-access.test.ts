import { describe, expect, it } from 'vitest';

import type { SessionRoleState } from '../_shell/use-session-role';
import {
  isSettingsOpenForStaffAwaitingRole,
  SETTINGS_ALLOWED_SURFACES,
} from './settings-access';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
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

describe('SETTINGS_ALLOWED_SURFACES', () => {
  it.each(['student', 'staff', 'admin'] as const)(
    '%s surface는 설정을 쓴다',
    (surface) => {
      expect(SETTINGS_ALLOWED_SURFACES).toContain(surface);
    },
  );
});

describe('isSettingsOpenForStaffAwaitingRole', () => {
  it.each(['PENDING', 'APPROVED'] as const)(
    '역할 요청이 %s 인 교직원에게 연다',
    (staffAccessRequestStatus) => {
      expect(
        isSettingsOpenForStaffAwaitingRole(
          state({
            status: 'unassigned',
            staffAccessRequestStatus,
            selectedRole: 'STAFF',
          }),
        ),
      ).toBe(true);
    },
  );

  it('역할 요청이 없는 사용자에게는 열지 않는다', () => {
    expect(
      isSettingsOpenForStaffAwaitingRole(
        state({ status: 'unassigned', staffAccessRequestStatus: null }),
      ),
    ).toBe(false);
  });

  it.each(['STUDENT', 'STAFF'] as const)(
    '가입 중 %s를 고르기만 한 사용자에게는 열지 않는다',
    (selectedRole) => {
      expect(
        isSettingsOpenForStaffAwaitingRole(
          state({
            status: 'unassigned',
            staffAccessRequestStatus: null,
            selectedRole,
          }),
        ),
      ).toBe(false);
    },
  );

  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 상태에는 열지 않는다',
    (staffAccessRequestStatus) => {
      expect(
        isSettingsOpenForStaffAwaitingRole(
          state({ status: 'unassigned', staffAccessRequestStatus }),
        ),
      ).toBe(false);
    },
  );

  it.each(['anonymous', 'loading', 'error', 'assigned'] as const)(
    '%s 상태에는 역할 요청이 살아 있어도 열지 않는다',
    (status) => {
      for (const staffAccessRequestStatus of ['PENDING', 'APPROVED'] as const) {
        expect(
          isSettingsOpenForStaffAwaitingRole(
            state({ status, staffAccessRequestStatus }),
          ),
        ).toBe(false);
      }
    },
  );
});
