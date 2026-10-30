import type {
  AdminAccessUserRecord,
  AdminAccessActor,
} from './admin-access-repository.types';
import {
  ADMIN_ACCESS_REQUEST_EFFECTS,
  type AdminAccessRequestEffect,
  ADMIN_ACCESS_DECISION_KINDS,
} from './admin-access-transition-table.policy';
import {
  type AdminAccessMutationCommand,
  ADMIN_ACCESS_REQUEST_DECISIONS,
} from './admin-access.types';
import { StaffAccessRequestStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { ROLES_ERROR_CODES, RolesErrorCode } from './roles-error-code.error';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';

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
  if (command.desiredRole === 'ADMIN') {
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
      return before.hasStaffAccess;
    case ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED:
      return false;
    case ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED:
      if (command.desiredRole === 'STAFF') {
        return true;
      }
      return before.hasStaffAccess;
    default:
      return assertNeverForAdminAccessAuthorityWrite(requestEffect);
  }
}

function assertNeverForAdminAccessAuthorityWrite(value: never): never {
  throw new TypeError(`Unsupported authority request effect: ${String(value)}`);
}

export function matchesExpectedAccessState(
  current: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
): boolean {
  if (current.accountStatus !== command.expectedAccountStatus) {
    return false;
  }
  const expectedRequest = command.expectedPendingRequest;
  const currentRequest = current.pendingRequest;
  const pendingMatches =
    expectedRequest === null
      ? currentRequest === null
      : currentRequest?.id === expectedRequest.id;
  if (!pendingMatches) {
    return false;
  }
  const expectedStaff = command.expectedHasStaffAccess;
  const expectedAdmin = command.expectedHasAdminAccess;
  if (expectedStaff !== undefined || expectedAdmin !== undefined) {
    return (
      expectedStaff !== undefined &&
      expectedAdmin !== undefined &&
      current.hasStaffAccess === expectedStaff &&
      current.hasAdminAccess === expectedAdmin
    );
  }

  return current.role === command.expectedRole;
}

export function toAdminAccessDecisionKind(
  command: AdminAccessMutationCommand,
):
  | typeof ADMIN_ACCESS_DECISION_KINDS.NONE
  | typeof ADMIN_ACCESS_DECISION_KINDS.APPROVE
  | typeof ADMIN_ACCESS_DECISION_KINDS.REJECT {
  const decision = command.requestDecision;
  if (!decision) {
    return ADMIN_ACCESS_DECISION_KINDS.NONE;
  }
  switch (decision.decision) {
    case ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE:
      return ADMIN_ACCESS_DECISION_KINDS.APPROVE;
    case ADMIN_ACCESS_REQUEST_DECISIONS.REJECT:
      return ADMIN_ACCESS_DECISION_KINDS.REJECT;
    default:
      return assertNeverForAdminAccessMutation(decision);
  }
}

function grantsAdminToSelf(
  actor: AdminAccessActor,
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
): boolean {
  return (
    actor.id === before.id &&
    command.desiredRole === 'ADMIN' &&
    before.role !== 'ADMIN'
  );
}

export function enforceAdminAccessGuards(
  actor: AdminAccessActor,
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
  outcome: {
    readonly requiresCompleteProfile: boolean;
    readonly requiresSelfDeactivationGuard: boolean;
    readonly requiresLastActiveAdminGuard: boolean;
  },
  activeAdminCount: number | null,
): void {
  if (grantsAdminToSelf(actor, before, command)) {
    throw roleError(RolesErrorCode.ADMIN_ONLY);
  }
  if (outcome.requiresSelfDeactivationGuard && actor.id === before.id) {
    throw roleError(RolesErrorCode.SELF_DEACTIVATION_FORBIDDEN);
  }
  if (
    outcome.requiresLastActiveAdminGuard &&
    (activeAdminCount === null || activeAdminCount <= 1)
  ) {
    throw roleError(RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED);
  }
  if (outcome.requiresCompleteProfile && !before.isProfileComplete) {
    throw new DomainException(
      USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
    );
  }
}

export const ADMIN_ACCESS_REQUEST_WRITE_KINDS = {
  NONE: 'NONE',
  DECIDE_PENDING: 'DECIDE_PENDING',
  INSERT_REVOKED: 'INSERT_REVOKED',
} as const;

export type AdminAccessRequestWrite =
  | { readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.NONE }
  | {
      readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.DECIDE_PENDING;
      readonly requestId: string;
      readonly nextStatus:
        | typeof StaffAccessRequestStatus.APPROVED
        | typeof StaffAccessRequestStatus.REJECTED;
    }
  | { readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.INSERT_REVOKED };

export function toAdminAccessRequestWrite(
  before: AdminAccessUserRecord,
  effect: AdminAccessRequestEffect,
): AdminAccessRequestWrite {
  switch (effect) {
    case ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED:
      return { kind: ADMIN_ACCESS_REQUEST_WRITE_KINDS.NONE };
    case ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED:
      return { kind: ADMIN_ACCESS_REQUEST_WRITE_KINDS.INSERT_REVOKED };
    case ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED:
    case ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED: {
      const pendingRequest = before.pendingRequest;
      if (!pendingRequest) {
        throw staleAccessError(before);
      }
      return {
        kind: ADMIN_ACCESS_REQUEST_WRITE_KINDS.DECIDE_PENDING,
        requestId: pendingRequest.id,
        nextStatus: effect,
      };
    }
    default:
      return assertNeverForAdminAccessMutation(effect);
  }
}

export function roleError(code: RolesErrorCode): DomainException {
  return new DomainException(ROLES_ERROR_CODES[code]);
}

export function staleAccessError(
  current: Pick<
    AdminAccessUserRecord,
    'id' | 'role' | 'accountStatus' | 'pendingRequest'
  >,
): DomainException {
  return new DomainException(
    ROLES_ERROR_CODES[RolesErrorCode.ACCESS_STATE_MISMATCH],
    {
      currentAccess: {
        id: current.id,
        role: current.role,
        accountStatus: current.accountStatus,
        pendingRequest: current.pendingRequest
          ? {
              id: current.pendingRequest.id,
              status: StaffAccessRequestStatus.PENDING,
              createdAt: current.pendingRequest.createdAt.toISOString(),
            }
          : null,
      },
    },
  );
}

function assertNeverForAdminAccessMutation(value: never): never {
  throw new TypeError(`Unsupported admin access variant: ${String(value)}`);
}
