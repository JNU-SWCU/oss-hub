import { AccountStatus } from '@prisma/client';
import {
  AUTH_ERROR_CODES,
  AuthErrorCode,
} from '../auth/domain/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from './domain/roles-error-code.enum';
import type { AdminAccessActor } from './admin-access.repository';
import { isStaffOnlyAccess } from './admin-access-transition-table';
import {
  ADMIN_ACCESS_REQUEST_DECISIONS,
  type AdminAccessMutationCommand,
} from './domain/admin-access';

export function requireActiveAdmin(
  actor: AdminAccessActor | null,
): AdminAccessActor {
  if (!actor || actor.accountStatus !== AccountStatus.ACTIVE) {
    throw new DomainException(AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]);
  }
  if (!actor.hasAdminAccess) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
  return actor;
}

export function requireActiveStaffOrAdmin(
  actor: AdminAccessActor | null,
): AdminAccessActor {
  if (!actor || actor.accountStatus !== AccountStatus.ACTIVE) {
    throw new DomainException(AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED]);
  }
  if (!actor.hasStaffAccess && !actor.hasAdminAccess) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
  return actor;
}

export function isAdminActor(actor: AdminAccessActor): boolean {
  return actor.hasAdminAccess;
}

function isRequestDecisionCommand(
  command: AdminAccessMutationCommand,
): boolean {
  const decision = command.requestDecision?.decision;
  return (
    decision === ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE ||
    decision === ADMIN_ACCESS_REQUEST_DECISIONS.REJECT
  );
}

export function assertAccessMutationAllowed(
  actor: AdminAccessActor,
  targetUserId: string,
  command: AdminAccessMutationCommand,
): void {
  if (actor.id === targetUserId && isRequestDecisionCommand(command)) {
    throw new DomainException(
      ROLES_ERROR_CODES[RolesErrorCode.SELF_ACCESS_MUTATION_FORBIDDEN],
    );
  }
  if (isAdminActor(actor)) {
    return;
  }
  const decision = command.requestDecision?.decision;
  if (
    decision !== ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE &&
    decision !== ADMIN_ACCESS_REQUEST_DECISIONS.REJECT
  ) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
  assertDecisionOnlyCommand(decision, command);
}

function assertDecisionOnlyCommand(
  decision:
    | typeof ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE
    | typeof ADMIN_ACCESS_REQUEST_DECISIONS.REJECT,
  command: AdminAccessMutationCommand,
): void {
  if (command.desiredAccountStatus !== command.expectedAccountStatus) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
  const allowedDesiredRole =
    decision === ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE
      ? isStaffOnlyAccess(command.desiredRole)
      : command.desiredRole === command.expectedRole;
  if (!allowedDesiredRole) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
}
