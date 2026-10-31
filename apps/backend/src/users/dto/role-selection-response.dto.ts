import type {
  MemberKindSelectionResult,
  MemberKindSelectionState,
  SelectableMemberKind,
} from '../member-onboarding.repository';

export class RoleSelectionResponseDto {
  declare readonly selectedRole: SelectableMemberKind;

  declare readonly redirectTo: '/onboarding/profile';

  static from(result: MemberKindSelectionResult): RoleSelectionResponseDto {
    return {
      selectedRole: result.selectedMemberKind,
      redirectTo: result.redirectTo,
    };
  }
}

export class MemberKindSelectionStateResponseDto {
  declare readonly selectedRole: SelectableMemberKind | null;

  static from(
    state: MemberKindSelectionState,
  ): MemberKindSelectionStateResponseDto {
    return { selectedRole: state.selectedMemberKind };
  }
}
