import { describe, expect, it } from 'vitest';

import { PENDING_PROFILE_EDIT_PATH } from '@/features/roles/components/role-request-screen';

import { isSettingsOpenForStaffAwaitingRole } from '../../settings/settings-access';
import type { SessionRoleState } from '../../_shell/use-session-role';

/**
 * 승인 대기 화면이 내주는 길이 실제로 열려 있는가(#598).
 *
 * 길을 내는 쪽(`features/roles/components/role-request-screen.tsx`)과 문을 여는 쪽
 * (`app/settings/settings-access.ts`)이 서로 다른 파일에 있고, feature는 app을
 * import할 수 없어 한 판단을 함께 쓸 수 없다. 두 곳이 갈라지면 사용자는 링크를 눌러도
 * 설정에서 튕겨 나와 같은 화면으로 되돌아온다 — 고칠 방법이 없던 #581 이전과 증상이
 * 같아진다. 그 갈라짐을 여기서 못박는다.
 */
function state(overrides: Partial<SessionRoleState> = {}): SessionRoleState {
  return {
    status: 'unassigned',
    role: null,
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
    // Given / When / Then — 경로가 바뀌면 아래 문 판정도 같은 화면을 봐야 한다
    expect(PENDING_PROFILE_EDIT_PATH).toBe('/settings');
  });

  it('링크를 내주는 승인 대기 교직원에게 그 화면이 열려 있다', () => {
    // Given — 이 링크가 실제로 그려지는 유일한 갈래
    const pending = state({ staffAccessRequestStatus: 'PENDING' });

    // When / Then
    expect(isSettingsOpenForStaffAwaitingRole(pending)).toBe(true);
  });

  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 상태에는 그 화면이 닫혀 있다 — 그래서 링크도 그리지 않는다',
    (staffAccessRequestStatus) => {
      // Given
      const closed = state({ staffAccessRequestStatus });

      // When / Then — 열려 있다면 링크 조건(`PENDING`만)이 너무 좁다는 뜻이다
      expect(isSettingsOpenForStaffAwaitingRole(closed)).toBe(false);
    },
  );
});
