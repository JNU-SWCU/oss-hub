import { MemberKind } from '@prisma/client';
import { IsString } from 'class-validator';
import { DomainException } from '../../platform/error-code.error';
import type { SelectableMemberKind } from '../users.types';
import { ROLES_ERROR_CODES, RolesErrorCode } from '../roles-error-code.error';

export class SelectStaffAccessRequestDto {
  @IsString()
  declare readonly selectedRole: string;

  toMemberKind(): SelectableMemberKind {
    switch (this.selectedRole) {
      case MemberKind.STUDENT:
        return MemberKind.STUDENT;
      case MemberKind.STAFF:
        return MemberKind.STAFF;
      default:
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.INVALID_ROLE_SELECTION],
        );
    }
  }
}
