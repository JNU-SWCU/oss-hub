import { SIGNUP_FLOW_PATHS } from './signup-routes';
import type { SessionRoleState } from './use-session-role';

/**
 * 가입을 마쳤는지 판정하는 데 필요한 만큼의 세션 상태.
 *
 * `role`은 받지 않는다 — 이 판정에 필요한 것은 "역할이 붙었는가"(`status`)이지
 * 어떤 역할인지가 아니고, 받아 두면 호출부가 역할별 예외를 여기에 넣기 시작한다.
 */
export type SignupCompletionState = Pick<
  SessionRoleState,
  'status' | 'roleRequestStatus' | 'isProfileComplete'
>;

/**
 * 이 사람이 회원인가 — **가입 절차를 끝까지 걸었는가**.
 *
 * 가입은 약관 동의 → 역할 선택 → 프로필 입력이고, 셋을 다 마쳐야 회원이다. GitHub
 * 로그인은 그 절차의 입구일 뿐이라, 로그인만 하고 떠난 사람은 우리와 연결돼 있어도
 * 아직 회원이 아니다.
 *
 * - `assigned`: 역할이 붙었어도 프로필이 비어 있으면 아직 아니다. 순서를 역할 →
 *   프로필로 바꾼 뒤 생긴 정상 상태이고(학생은 역할이 즉시 배정된다), 그 사람은
 *   프로필 단계에서 창을 닫은 사람이다. `RoleGate`가 같은 근거로 그를 프로필로
 *   되돌린다(`role-gate.tsx`).
 * - `unassigned`: **살아 있는 역할 요청이 있으면 회원으로 본다.** 교직원은 프로필까지
 *   마쳐도 관리자가 승인하기 전에는 세션 역할이 비어 있다 — 여기서 프로필 완료
 *   여부까지 따지면 그 사람이 회원에서 떨어져 나간다. 세션의 `isProfileComplete`로는
 *   구분할 수도 없다: 백엔드는 그 값을 **배정된 역할** 기준으로 계산하므로
 *   (`auth/auth.repository.ts`), 역할이 없는 동안에는 가장 엄격한 학생 기준으로
 *   판정돼 학번이 필요 없는 교직원이 항상 미완료로 나온다. 잘못 끊는 쪽보다 조금
 *   넓게 보는 쪽을 고른다 — 대신 프로필을 아직 안 채운 교직원도 회원으로 세어지고,
 *   그 사람은 게이트가 곧 온보딩으로 되돌린다.
 * - `loading`·`error`: 아직 모른다. 모르는 동안 회원이라고 말하지 않는다.
 */
export function isSignupComplete(state: SignupCompletionState): boolean {
  switch (state.status) {
    case 'loading':
    case 'error':
    case 'anonymous':
      return false;
    case 'assigned':
      return state.isProfileComplete;
    case 'unassigned':
      return (
        state.roleRequestStatus === 'PENDING' ||
        state.roleRequestStatus === 'APPROVED'
      );
    default: {
      const exhaustive: never = state.status;
      return exhaustive;
    }
  }
}

/**
 * 헤더 오른쪽 계정 슬롯(`LoginButton`)을 낼 것인가.
 *
 * 그 슬롯은 방문자에게는 "회원가입 / 로그인" 버튼을, 로그인한 사람에게는 GitHub
 * 계정 메뉴를 낸다. 그래서 "숨긴다"의 대상은 **계정 메뉴**뿐이고, 비로그인은 언제나
 * 그대로 둔다 — 여기서 접으면 로그인 버튼이 제품 어디에도 없어진다.
 *
 * 가입을 마치지 않은 사람에게는 가입 화면 안에서만 계정을 보여 준다. 그 화면에서는
 * 표식이 "이 절차가 이어지고 있다"는 뜻이지만, 밖에서는 "이 사람은 회원이다"로
 * 읽히기 때문이다. 밖에서 그 자리는 비게 되지 않는다 — 옆의 `SessionEntryNavLink`가
 * 방문자와 같은 "회원가입 / 로그인" 버튼을 내며(`role-home-link.tsx`), 그 버튼이
 * 멈춘 자리로 되돌려 준다.
 */
export function shouldShowAccountSlot(
  state: SignupCompletionState,
  pathname: string,
): boolean {
  return (
    state.status === 'anonymous' ||
    isSignupComplete(state) ||
    SIGNUP_FLOW_PATHS.has(pathname)
  );
}
