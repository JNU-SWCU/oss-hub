export type RoleSelection = 'STUDENT' | 'STAFF';

export type StaffAccessRequestStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface RoleSelectionResult {
  readonly selectedRole: RoleSelection;
  /**
   * 백엔드 `roles/domain/member-onboarding.ts`와 같은 단일 값 — 학생·교직원 모두
   * 프로필 입력으로 간다. 역할이 정해져도 프로필을 받아야 가입이 끝나기 때문이다.
   *
   * 화면은 이 값을 그대로 `window.location.assign`에 넘길 뿐 검사하지 않는다
   * (`components/role-selection-screen.tsx`의 `navigateAfterRoleSelection`은
   * `string`을 받는다). 그래서 이 좁히기는 컴파일 시점 계약일 뿐 런타임 동작을
   * 바꾸지 않는다 — 앞뒤 배포가 어긋나 옛 값이 와도 이동은 그대로 된다.
   */
  readonly redirectTo: '/onboarding/profile';
}

/**
 * 지금 고른 역할. 아직 고르지 않았으면 `null`이다.
 *
 * 역할 선택은 이제 아무것도 확정하지 않고 **고른 사실만 기록한다**(#569). 그래서
 * "이 사람이 무엇을 골랐는가"를 아는 곳이 따로 필요해졌다 — 되돌아온 역할 선택
 * 화면이 이전 선택을 되살리고, 프로필 화면이 무엇을 물을지 정하는 근거다.
 *
 * 세션(`features/auth`)이 아니라 여기 있는 이유는 이 값이 권한이 아니라 가입 절차의
 * 상태이기 때문이다. 세션에 실으면 아직 확정되지 않은 값이 권한처럼 읽힌다.
 */
export interface RoleSelectionState {
  readonly selectedRole: RoleSelection | null;
}

export interface StaffAccessRequest {
  readonly requestedRole: 'STAFF';
  readonly status: StaffAccessRequestStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly rejectionReason: string | null;
}
