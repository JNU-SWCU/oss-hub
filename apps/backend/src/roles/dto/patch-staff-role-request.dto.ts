import { IsOptional, IsString } from 'class-validator';
import { DomainException } from '../../common/error-code';
import {
  STAFF_ROLE_REQUEST_ACTIONS,
  type StaffRoleRequestAction,
} from '../domain/staff-role-request';
import { ROLES_ERROR_CODES, RolesErrorCode } from '../roles-error-code.enum';

export class PatchStaffRoleRequestDto {
  @IsString()
  declare readonly action: string;

  @IsOptional()
  @IsString()
  declare readonly reason?: string;

  toAction(): StaffRoleRequestAction {
    switch (this.action) {
      case STAFF_ROLE_REQUEST_ACTIONS.APPROVE:
        return { action: STAFF_ROLE_REQUEST_ACTIONS.APPROVE };
      case STAFF_ROLE_REQUEST_ACTIONS.REJECT: {
        const reason = this.reason?.trim();
        if (!reason) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.REJECTION_REASON_REQUIRED],
          );
        }
        return { action: STAFF_ROLE_REQUEST_ACTIONS.REJECT, reason };
      }
      case STAFF_ROLE_REQUEST_ACTIONS.REVOKE:
        return { action: STAFF_ROLE_REQUEST_ACTIONS.REVOKE };
      default:
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.INVALID_ROLE_REQUEST_ACTION],
        );
    }
  }
}
