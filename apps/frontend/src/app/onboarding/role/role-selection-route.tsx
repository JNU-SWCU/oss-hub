'use client';

import { RoleSelectionScreen } from '@/features/roles/components/role-selection-screen';
import { useSharedSessionRole } from '../../_shell/session-role-context';

/**
 * 게이트가 판단에 쓴 스냅샷을 역할 선택 화면으로 넘기는 얇은 경계.
 *
 * 이 조각이 `app`에 있어야 하는 이유는 의존 방향이다. 스냅샷은 `app/_shell`에 있고
 * `features`는 `app`을 import할 수 없다(`eslint.config.mjs`의 `appReverseDependencyBan`).
 * 그래서 화면이 스냅샷을 **가지러 올** 수는 없고, `app`이 **내려 줘야** 한다. 조합은
 * app의 일이라는 규칙(`app/AGENTS.md`)과도 같은 방향이다.
 *
 * 화면이 스스로 조회하던 것을 여기로 옮긴 것이 #673의 본체다. 예전에는
 * `RoleSelectionScreen`이 `fetchMyRoleRequest`를 직접 불러 반려 사유를 읽었는데, 그
 * 조회는 게이트가 이미 한 조회를 한 번 더 하는 것이었고 **실패하면 조용히 삼켜졌다**.
 * 그 결과 게이트는 반려로 판단해 이 화면을 열어 주고, 화면은 사유 없이 그린다 —
 * 처음 가입할 때와 똑같은 화면이라 사용자는 자기가 왜 거절당했는지 알 방법이 없다.
 * 지금은 접근을 정한 근거와 화면이 그리는 근거가 **같은 순간의 같은 값**이다.
 *
 * 회수(`REVOKED`)는 아직 사유를 저장하지 않아 안내 대상이 아니다. 붙게 되면 이 함수의
 * 조건 하나와 `ClosedRoleRequestNotice`의 상태 표에 항목 하나만 늘면 된다.
 */
export function RoleSelectionRoute() {
  const { roleRequestStatus, roleRequestRejectionReason, selectedRole } =
    useSharedSessionRole();

  return (
    <RoleSelectionScreen
      initialSelectedRole={selectedRole}
      rejection={
        roleRequestStatus === 'REJECTED'
          ? { status: 'REJECTED', reason: roleRequestRejectionReason }
          : null
      }
    />
  );
}
