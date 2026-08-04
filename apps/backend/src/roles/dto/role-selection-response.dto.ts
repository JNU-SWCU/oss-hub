import type {
  RoleSelectionResult,
  RoleSelectionState,
  SelectableRole,
} from '../domain/role-onboarding';

/**
 * 역할 선택의 답. 확정 결과(`role`·`requestStatus`)는 싣지 않는다 — 이 화면이
 * 아무것도 확정하지 않기 때문이다. 근거는 `domain/role-onboarding.ts`에 있다(#569).
 */
export class RoleSelectionResponseDto {
  readonly selectedRole: SelectableRole;
  /** 도메인 결과와 같은 단일 값. 근거는 `domain/role-onboarding.ts`에 있다. */
  readonly redirectTo: '/onboarding/profile';

  private constructor(result: RoleSelectionResult) {
    this.selectedRole = result.selectedRole;
    this.redirectTo = result.redirectTo;
  }

  static from(result: RoleSelectionResult): RoleSelectionResponseDto {
    return new RoleSelectionResponseDto(result);
  }
}

/** 지금 고른 역할. 아직 고르지 않았으면 `null`이다. */
export class RoleSelectionStateResponseDto {
  readonly selectedRole: SelectableRole | null;

  private constructor(state: RoleSelectionState) {
    this.selectedRole = state.selectedRole;
  }

  static from(state: RoleSelectionState): RoleSelectionStateResponseDto {
    return new RoleSelectionStateResponseDto(state);
  }
}
