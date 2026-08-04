import type { AppRole } from '../_shell/role';
import type { SessionRoleState } from '../_shell/use-session-role';

/**
 * 설정(#156) 접근 허용 역할 — 역할이 확정된 모든 사용자.
 *
 * 로그인만 확인하던 `AuthGate`로는 부족했다. 가입을 끝내지 않은(역할 미배정)
 * 사용자가 프로필·알림 설정을 먼저 바꿀 수 있었고, 그 값은 곧이어 온보딩의
 * 프로필 입력이 다시 덮어쓴다. 대시보드와 같은 규칙으로 온보딩을 먼저 마치게 한다.
 *
 * 특정 역할을 가리는 화면이 아니므로 세 역할을 모두 허용한다 — 여기서 걸러야 할
 * 것은 "어떤 역할인가"가 아니라 "역할이 있는가"다.
 */
export const SETTINGS_ALLOWED_ROLES: readonly AppRole[] = [
  'STUDENT',
  'STAFF',
  'ADMIN',
];

/**
 * 역할이 아직 없는 사용자 중 설정을 열어 줄 **유일한** 갈래: 승인을 기다리는 교직원.
 *
 * #581이 요구한 것이 정확히 그 한 사람이다. 교직원은 관리자가 승인해야 세션에 역할이
 * 붙는데, 그 사이 이름에 오타가 있어도 고칠 자리가 없었다. 역할 요청은 교직원만
 * 만들고(`features/roles/types.ts`의 `RoleRequest.requestedRole`이 `'STAFF'`
 * 하나다) 살아 있는 요청의 상태가 `PENDING`이므로, "승인 대기 교직원"은 곧
 * `unassigned` + `PENDING`이다.
 *
 * 나머지 네 갈래는 예전 계약(`ed2a187`)대로 온보딩으로 되돌린다. 열어 주면 안 되는
 * 이유가 갈래마다 다르다.
 *
 * - **요청 없음(`null`)** — 아직 역할조차 고르지 않았다. 여기서 프로필·알림을 먼저
 *   저장해 봐야 곧이어 온보딩의 프로필 입력이 덮어쓴다. 되돌려 보내는 것이 그 사람이
 *   실제로 해야 할 다음 일이다.
 * - **`REJECTED`·`REVOKED`** — 교직원이 아니게 된 사람이다. 승인 대기 중이라는 전제가
 *   깨졌으므로 승인 대기 교직원에게 준 예외를 물려받을 근거가 없다. 두 상태의 다음
 *   자리는 반려 사유를 읽고 역할을 다시 고르는 화면이다.
 * - **가입 중 역할만 고른 사람(`selectedRole`만 있음, #569)** — 확정을 `가입 마치기`로
 *   미룬 구간이라 아직 아무것도 신청하지 않았다. 이 사람에게 설정을 열면 가입 절차
 *   한가운데서 옆길이 하나 생기고, 그 옆길에서 저장한 값을 뒤이은 프로필 입력이 다시
 *   덮어쓴다.
 *
 * `APPROVED`도 열지 않는다. 승인이 끝났으면 세션에 역할이 붙어 `assigned`로 들어오는
 * 것이 정상이고, 그 조합은 세션이 아직 갱신되지 않은 찰나일 뿐이다. 요청받지 않은
 * 상태까지 넓히지 않는다 — 넓히는 것은 이 예외의 성격상 언제든 다시 할 수 있지만,
 * 한 번 넓힌 권한을 도로 좁히는 일은 사용자에게 기능이 사라진 것으로 읽힌다.
 */
export function isSettingsOpenForPendingStaff(
  state: SessionRoleState,
): boolean {
  return state.status === 'unassigned' && state.roleRequestStatus === 'PENDING';
}
