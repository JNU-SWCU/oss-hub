import { IsDefined, IsString } from 'class-validator';
import { DomainException } from '../../platform/error-code.error';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../domain/roles-error-code.enum';
import {
  ADMIN_ACCESS_COMMANDS,
  type AdminAuthorityMutationCommand,
} from '../domain/independent-authority';

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
