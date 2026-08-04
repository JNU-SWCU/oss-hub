import { describe, expect, it } from 'vitest';

import type { SessionRoleState } from '../_shell/use-session-role';
import {
  isSettingsOpenForPendingStaff,
  SETTINGS_ALLOWED_ROLES,
} from './settings-access';

function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'loading',
    role: null,
    roleRequestStatus: null,
    selectedRole: null,
    isProfileComplete: false,
    ...overrides,
  };
}

describe('SETTINGS_ALLOWED_ROLES', () => {
  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '역할이 확정된 %s는 설정을 쓴다 — 여기서 가리는 것은 역할 종류가 아니다',
    (role) => {
      expect(SETTINGS_ALLOWED_ROLES).toContain(role);
    },
  );
});

/**
 * 설정을 역할 없이 열어 주는 **유일한** 갈래를 못 박는 자리다(#581).
 *
 * `unassigned`에는 성격이 다른 다섯 사람이 들어 있는데, 이 규칙이 인정하는 것은 그중
 * 승인 대기 교직원 하나다. 나머지 넷을 함께 열면 가입을 마치기 전에는 프로필·알림을
 * 고칠 수 없다는 예전 계약(`ed2a187`)이 조용히 뒤집힌다 — 신고(#581)가 요구한 것보다
 * 훨씬 넓다.
 */
describe('isSettingsOpenForPendingStaff', () => {
  it('승인을 기다리는 교직원에게 연다', () => {
    expect(
      isSettingsOpenForPendingStaff(
        state({
          status: 'unassigned',
          roleRequestStatus: 'PENDING',
          selectedRole: 'STAFF',
        }),
      ),
    ).toBe(true);
  });

  // 아직 역할조차 고르지 않았다. 여기서 저장한 값은 곧이어 온보딩의 프로필 입력이
  // 덮어쓴다.
  it('역할 요청이 없는 사용자에게는 열지 않는다', () => {
    expect(
      isSettingsOpenForPendingStaff(
        state({ status: 'unassigned', roleRequestStatus: null }),
      ),
    ).toBe(false);
  });

  // #569 이후 생긴 구간 — 역할을 골랐을 뿐 아직 아무것도 신청하지 않았다.
  it.each(['STUDENT', 'STAFF'] as const)(
    '가입 중 %s를 고르기만 한 사용자에게는 열지 않는다',
    (selectedRole) => {
      expect(
        isSettingsOpenForPendingStaff(
          state({
            status: 'unassigned',
            roleRequestStatus: null,
            selectedRole,
          }),
        ),
      ).toBe(false);
    },
  );

  // 교직원이 아니게 된 사람이다. 승인 대기라는 전제가 깨졌으므로 그 예외를 물려받을
  // 근거가 없다.
  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 상태에는 열지 않는다',
    (roleRequestStatus) => {
      expect(
        isSettingsOpenForPendingStaff(
          state({ status: 'unassigned', roleRequestStatus }),
        ),
      ).toBe(false);
    },
  );

  // 승인이 끝났으면 세션에 역할이 붙어 `assigned`로 들어오는 것이 정상이다.
  it('APPROVED 인데 아직 역할이 없는 찰나에도 넓히지 않는다', () => {
    expect(
      isSettingsOpenForPendingStaff(
        state({ status: 'unassigned', roleRequestStatus: 'APPROVED' }),
      ),
    ).toBe(false);
  });

  /**
   * 미배정이 아닌 상태는 이 규칙이 답할 문제가 아니다. `PENDING`이 남아 있어도
   * 상태가 다르면 거절해, 공용 게이트의 방어와 이중으로 막는다.
   */
  it.each(['anonymous', 'loading', 'error', 'assigned'] as const)(
    '%s 상태에는 역할 요청이 PENDING이어도 열지 않는다',
    (status) => {
      expect(
        isSettingsOpenForPendingStaff(
          state({ status, roleRequestStatus: 'PENDING' }),
        ),
      ).toBe(false);
    },
  );
});
