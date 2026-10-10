import { DomainException } from '../../common/error-code';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.enum';

const USER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export function requireValidUserId(id: string): void {
  if (id === 'me' || !USER_ID_PATTERN.test(id)) {
    throw new DomainException(
      ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ID],
    );
  }
}
