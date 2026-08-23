import type {
  MemberKindSelectionResult,
  MemberKindSelectionState,
  SelectableMemberKind,
} from '../domain/member-onboarding';

/**
 * 회원 유형 선택의 답. 확정 결과는 싣지 않는다 — 이 화면이 아무것도 확정하지 않기
 * 때문이다. 근거는 `domain/member-onboarding.ts`에 있다(#569).
 *
 * 필드 이름 `selectedRole`은 전송 계약이라 그대로 둔다(`select-role-request.dto.ts`).
 */
export class RoleSelectionResponseDto {
  readonly selectedRole: SelectableMemberKind;
  /** 도메인 결과와 같은 단일 값. 근거는 `domain/member-onboarding.ts`에 있다. */
  readonly redirectTo: '/onboarding/profile';

  private constructor(result: MemberKindSelectionResult) {
    this.selectedRole = result.selectedMemberKind;
    this.redirectTo = result.redirectTo;
  }

  static from(result: MemberKindSelectionResult): RoleSelectionResponseDto {
    return new RoleSelectionResponseDto(result);
  }
}

/** 지금 고른 회원 유형. 아직 고르지 않았으면 `null`이다. */
export class RoleSelectionStateResponseDto {
  readonly selectedRole: SelectableMemberKind | null;

  private constructor(state: MemberKindSelectionState) {
    this.selectedRole = state.selectedMemberKind;
  }

  static from(state: MemberKindSelectionState): RoleSelectionStateResponseDto {
    return new RoleSelectionStateResponseDto(state);
  }
}
