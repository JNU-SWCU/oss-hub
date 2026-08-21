import { describe, expect, it } from 'vitest';

import type { SessionRoleState } from '../_shell/use-session-role';
import {
  isSettingsOpenForStaffAwaitingRole,
  SETTINGS_ALLOWED_SURFACES,
} from './settings-access';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
    role: null,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    roleRequestStatus: null,
    roleRequestRejectionReason: null,
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

/**
 * 설정을 역할 없이 열어 주는 갈래를 못 박는 자리다(#581).
 *
 * `unassigned`에는 성격이 다른 다섯 사람이 들어 있고, 이 규칙이 인정하는 것은 그중
 * 살아 있는 역할 요청을 가진 둘(`PENDING`·`APPROVED`)이다. 나머지 셋까지 함께 열면
 * 가입을 마치기 전에는 프로필·알림을 고칠 수 없다는 예전 계약(`ed2a187`)이 조용히
 * 뒤집힌다.
 */
describe('isSettingsOpenForStaffAwaitingRole', () => {
  /**
   * 살아 있는 요청 두 상태를 함께 연다.
   *
   * `APPROVED`는 유지보수자가 명시적으로 넓히기로 한 갈래다(2026-08-04). 검토는 처음에
   * `PENDING` 하나만 요구했지만, 결재가 끝나고 세션에 역할이 아직 오지 않은 사람이
   * 겪는 일은 #581과 완전히 같다 — 설정에서 튕겨 나가 자기 이름을 고치지 못한다.
   * 창이 좁다는 것은 닫아 둘 이유가 되지 못한다는 판단이다.
   */
  it.each(['PENDING', 'APPROVED'] as const)(
    '역할 요청이 %s 인 교직원에게 연다',
    (roleRequestStatus) => {
      expect(
        isSettingsOpenForStaffAwaitingRole(
          state({
            status: 'unassigned',
            roleRequestStatus,
            selectedRole: 'STAFF',
          }),
        ),
      ).toBe(true);
    },
  );

  // 아직 역할조차 고르지 않았다. 여기서 저장한 값은 곧이어 온보딩의 프로필 입력이
  // 덮어쓴다.
  it('역할 요청이 없는 사용자에게는 열지 않는다', () => {
    expect(
      isSettingsOpenForStaffAwaitingRole(
        state({ status: 'unassigned', roleRequestStatus: null }),
      ),
    ).toBe(false);
  });

  // #569 이후 생긴 구간 — 역할을 골랐을 뿐 아직 아무것도 신청하지 않았다.
  it.each(['STUDENT', 'STAFF'] as const)(
    '가입 중 %s를 고르기만 한 사용자에게는 열지 않는다',
    (selectedRole) => {
      expect(
        isSettingsOpenForStaffAwaitingRole(
          state({
            status: 'unassigned',
            roleRequestStatus: null,
            selectedRole,
          }),
        ),
      ).toBe(false);
    },
  );

  // 교직원이 아니게 된 사람이다. 기다릴 역할이 없으므로 그 예외를 물려받을 근거가 없다.
  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 상태에는 열지 않는다',
    (roleRequestStatus) => {
      expect(
        isSettingsOpenForStaffAwaitingRole(
          state({ status: 'unassigned', roleRequestStatus }),
        ),
      ).toBe(false);
    },
  );

  /**
   * 미배정이 아닌 상태는 이 규칙이 답할 문제가 아니다. 살아 있는 요청이 남아 있어도
   * 상태가 다르면 거절해, 공용 게이트의 방어와 이중으로 막는다.
   */
  it.each(['anonymous', 'loading', 'error', 'assigned'] as const)(
    '%s 상태에는 역할 요청이 살아 있어도 열지 않는다',
    (status) => {
      for (const roleRequestStatus of ['PENDING', 'APPROVED'] as const) {
        expect(
          isSettingsOpenForStaffAwaitingRole(
            state({ status, roleRequestStatus }),
          ),
        ).toBe(false);
      }
    },
  );
});
