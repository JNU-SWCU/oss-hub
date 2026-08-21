import { Role } from '@prisma/client';
import type { AdminAccessUserRecord } from './admin-access.repository';
import {
  ADMIN_ACCESS_REQUEST_EFFECTS,
  type AdminAccessRequestEffect,
} from './admin-access-transition-table';
import type { AdminAccessMutationCommand } from './domain/admin-access';

export type AuthorityWrite = {
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export function authorityAfterLegacyTransition(
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
  requestEffect: AdminAccessRequestEffect,
): AuthorityWrite {
  return {
    hasStaffAccess: staffAccessAfterLegacyTransition(
      before,
      command,
      requestEffect,
    ),
    hasAdminAccess: adminAccessAfterLegacyTransition(before, command),
  };
}

function adminAccessAfterLegacyTransition(
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
): boolean {
  if (command.desiredRole === Role.ADMIN) {
    return true;
  }
  return before.hasAdminAccess;
}

function staffAccessAfterLegacyTransition(
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
  requestEffect: AdminAccessRequestEffect,
): boolean {
  switch (requestEffect) {
    case ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED:
      return true;
    case ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED:
    case ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED:
      return false;
    case ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED:
      if (command.desiredRole === Role.STAFF) {
        return true;
      }
      return before.hasStaffAccess;
    default:
      return assertNever(requestEffect);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported authority request effect: ${String(value)}`);
}
