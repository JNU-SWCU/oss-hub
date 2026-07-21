import { IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import type { SelectableRole } from '../domain/role-onboarding';
import { ROLES_ERROR_CODES, RolesErrorCode } from '../roles-error-code.enum';

export class SelectRoleRequestDto {
  @IsString()
  declare readonly selectedRole: string;

  toRole(): SelectableRole {
    switch (this.selectedRole) {
      case Role.STUDENT:
        return Role.STUDENT;
      case Role.STAFF:
        return Role.STAFF;
      default:
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.INVALID_ROLE_SELECTION],
        );
    }
  }
}
