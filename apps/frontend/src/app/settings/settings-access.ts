import type { MemberSurface } from '../_shell/member-access';
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
export const SETTINGS_ALLOWED_SURFACES: readonly MemberSurface[] = [
  'student',
  'staff',
  'admin',
];

/**
 * 역할이 아직 없는 사용자 중 설정을 열어 줄 갈래: **역할을 기다리는 교직원**.
 *
 * 역할 요청은 교직원만 만든다(`features/roles/types.ts`의
 * `StaffAccessRequest.requestedRole`이 `'STAFF'` 하나다). 그래서 살아 있는 요청이 붙어 있는
 * 미배정 사용자는 곧 "세션에 아직 역할이 오지 않은 교직원"이다. 그 사람이 자기 이름의
 * 오타 하나를 고칠 자리가 없었던 것이 #581이다.
 *
 * 살아 있는 요청은 둘이다.
 *
 * - **`PENDING`** — 관리자의 결재를 기다린다. #581이 직접 가리킨 사람이다.
 * - **`APPROVED`** — 결재는 끝났는데 세션이 아직 그 역할을 물어 오지 않았다.
 *
 * `APPROVED`를 함께 여는 것은 **의도된 결정이다**(2026-08-04, 유지보수자 판단). 검토는
 * 처음에 `PENDING` 하나만 열 것을 요구했고 이 파일도 그렇게 좁혔었다. 그때의 근거는
 * "승인이 끝났으면 `assigned`로 들어오는 것이 정상이라 이 조합은 찰나일 뿐"이었는데,
 * 찰나든 아니든 그 창에 들어간 사람이 겪는 일은 #581과 **완전히 같다** — 설정에서
 * 튕겨 나가 자기 이름을 고치지 못한다. 고치지 못하는 사람을 없애자는 것이 이 티켓의
 * 목적이므로, 창이 좁다는 사실은 닫아 둘 이유가 되지 못한다.
 *
 * 이 창은 세션이 갱신되면 스스로 닫힌다 — 역할이 붙는 순간 `assigned`가 되어 이 규칙이
 * 아니라 `SETTINGS_ALLOWED_ROLES`가 답한다. 권한이 늘어난 것이 아니라, 역할이 도착하기
 * 전까지 같은 사람에게 같은 화면을 열어 두는 것뿐이다.
 *
 * 나머지 네 갈래는 예전 계약(`ed2a187`)대로 온보딩으로 되돌린다. 열어 주면 안 되는
 * 이유가 갈래마다 다르다.
 *
 * - **요청 없음(`null`)** — 아직 역할조차 고르지 않았다. 여기서 프로필·알림을 먼저
 *   저장해 봐야 곧이어 온보딩의 프로필 입력이 덮어쓴다. 되돌려 보내는 것이 그 사람이
 *   실제로 해야 할 다음 일이다.
 * - **`REJECTED`·`REVOKED`** — 교직원이 아니게 된 사람이다. 기다릴 역할이 없으므로
 *   역할을 기다리는 교직원에게 준 예외를 물려받을 근거가 없다. 두 상태의 다음 자리는
 *   반려 사유를 읽고 역할을 다시 고르는 화면이다.
 * - **가입 중 역할만 고른 사람(`selectedRole`만 있음, #569)** — 확정을 `가입 마치기`로
 *   미룬 구간이라 아직 아무것도 신청하지 않았다. 이 사람에게 설정을 열면 가입 절차
 *   한가운데서 옆길이 하나 생기고, 그 옆길에서 저장한 값을 뒤이은 프로필 입력이 다시
 *   덮어쓴다.
 */
export function isSettingsOpenForStaffAwaitingRole(
  state: SessionRoleState,
): boolean {
  if (state.status !== 'unassigned') {
    return false;
  }
  return (
    state.staffAccessRequestStatus === 'PENDING' ||
    state.staffAccessRequestStatus === 'APPROVED'
  );
}
