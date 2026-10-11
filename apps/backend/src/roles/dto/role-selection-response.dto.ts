import type {
  MemberKindSelectionResult,
  MemberKindSelectionState,
  SelectableMemberKind,
} from '../domain/member-onboarding';

export class RoleSelectionResponseDto {
  readonly selectedRole: SelectableMemberKind;

  readonly redirectTo: '/onboarding/profile';

  private constructor(result: MemberKindSelectionResult) {
    this.selectedRole = result.selectedMemberKind;
    this.redirectTo = result.redirectTo;
  }

  static from(result: MemberKindSelectionResult): RoleSelectionResponseDto {
    return new RoleSelectionResponseDto(result);
  }
}

export class MemberKindSelectionStateResponseDto {
  readonly selectedRole: SelectableMemberKind | null;

  private constructor(state: MemberKindSelectionState) {
    this.selectedRole = state.selectedMemberKind;
  }

  static from(
    state: MemberKindSelectionState,
  ): MemberKindSelectionStateResponseDto {
    return new MemberKindSelectionStateResponseDto(state);
  }
}
