import { AccountStatus, Role } from '@prisma/client';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import type { AdminAccessActor } from './admin-access.repository';

export function requireActiveAdmin(
  actor: AdminAccessActor | null,
): AdminAccessActor {
  if (!actor || actor.accountStatus !== AccountStatus.ACTIVE) {
    throw new DomainException(AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]);
  }
  if (actor.role !== Role.ADMIN) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
  return actor;
}
