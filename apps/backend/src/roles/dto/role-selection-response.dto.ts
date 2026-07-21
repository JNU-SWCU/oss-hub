import type { Role, RoleRequestStatus } from '@prisma/client';
import type {
  RoleSelectionResult,
  SelectableRole,
} from '../domain/role-onboarding';

export class RoleSelectionResponseDto {
  readonly selectedRole: SelectableRole;
  readonly role: Role | null;
  readonly requestStatus: RoleRequestStatus | null;
  readonly redirectTo: '/programs' | '/onboarding/pending';

  private constructor(result: RoleSelectionResult) {
    this.selectedRole = result.selectedRole;
    this.role = result.role;
    this.requestStatus = result.requestStatus;
    this.redirectTo = result.redirectTo;
  }

  static from(result: RoleSelectionResult): RoleSelectionResponseDto {
    return new RoleSelectionResponseDto(result);
  }
}
