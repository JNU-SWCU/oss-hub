export type RoleSelection = 'STUDENT' | 'STAFF';

export type RoleRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface RoleSelectionResult {
  readonly selectedRole: RoleSelection;
  readonly role: 'STUDENT' | null;
  readonly requestStatus: 'PENDING' | null;
  /**
   * 백엔드 `roles/domain/role-onboarding.ts`와 같은 단일 값 — 학생·교직원 모두
   * 프로필 입력으로 간다. 역할이 정해져도 프로필을 받아야 가입이 끝나기 때문이다.
   *
   * 화면은 이 값을 그대로 `window.location.assign`에 넘길 뿐 검사하지 않는다
   * (`components/role-selection-screen.tsx`의 `navigateAfterRoleSelection`은
   * `string`을 받는다). 그래서 이 좁히기는 컴파일 시점 계약일 뿐 런타임 동작을
   * 바꾸지 않는다 — 앞뒤 배포가 어긋나 옛 값이 와도 이동은 그대로 된다.
   */
  readonly redirectTo: '/onboarding/profile';
}

export interface RoleRequest {
  readonly requestedRole: 'STAFF';
  readonly status: RoleRequestStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly rejectionReason: string | null;
}
