import { IsDefined, IsString } from 'class-validator';
import { DomainException } from '../../common/error-code';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../../roles/roles-error-code.enum';
import {
  ADMIN_ACCESS_COMMANDS,
  STAFF_ACCESS_COMMANDS,
  type AdminAuthorityMutationCommand,
  type StaffAccessMutationCommand,
} from '../domain/independent-authority';

export class PatchStaffAccessRequestDto {
  @IsDefined()
  @IsString()
  declare readonly command: string;

  toCommand(): StaffAccessMutationCommand {
    switch (this.command) {
      case STAFF_ACCESS_COMMANDS.GRANT:
      case STAFF_ACCESS_COMMANDS.REVOKE:
        return { command: this.command };
      default:
        throw invalidAuthorityCommand();
    }
  }
}

export class PatchAdminAuthorityRequestDto {
  @IsDefined()
  @IsString()
  declare readonly command: string;

  toCommand(): AdminAuthorityMutationCommand {
    switch (this.command) {
      case ADMIN_ACCESS_COMMANDS.GRANT:
      case ADMIN_ACCESS_COMMANDS.REVOKE:
        return { command: this.command };
      default:
        throw invalidAuthorityCommand();
    }
  }
}

function invalidAuthorityCommand(): DomainException {
  return new DomainException(
    ROLES_ERROR_CODES[RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION],
  );
}
