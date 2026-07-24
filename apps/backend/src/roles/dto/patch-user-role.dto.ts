import { Role } from '@prisma/client';
import { IsString } from 'class-validator';
import { DomainException } from '../../common/error-code';
import { ROLES_ERROR_CODES, RolesErrorCode } from '../roles-error-code.enum';

export class PatchUserRoleRequestDto {
  @IsString()
  declare readonly role: string;

  toRole(): Role {
    switch (this.role) {
      case Role.STUDENT:
      case Role.STAFF:
      case Role.ADMIN:
        return this.role;
      default:
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ROLE],
        );
    }
  }
}
