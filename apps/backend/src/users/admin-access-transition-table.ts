import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import type { AuthorityLabel } from './domain/authority-label';
import { RolesErrorCode } from '../roles/roles-error-code.enum';

type AccessAuthority = {
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

function accessAuthorityOfRole(role: AuthorityLabel | null): AccessAuthority {
  switch (role) {
    case 'ADMIN':
      return { hasStaffAccess: true, hasAdminAccess: true };
    case 'STAFF':
      return { hasStaffAccess: true, hasAdminAccess: false };
    case 'STUDENT':
    case null:
      return { hasStaffAccess: false, hasAdminAccess: false };
  }
}

export function isStaffOnlyAccess(role: AuthorityLabel | null): boolean {
  const authority = accessAuthorityOfRole(role);
  return authority.hasStaffAccess && !authority.hasAdminAccess;
}

export const ADMIN_ACCESS_PENDING_STATES = {
  NONE: 'NONE',
  PENDING: 'PENDING',
} as const;

export const ADMIN_ACCESS_DECISION_KINDS = {
  NONE: 'NONE',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;

export const ADMIN_ACCESS_REQUEST_EFFECTS = {
  UNCHANGED: 'UNCHANGED',
  APPROVED: StaffAccessRequestStatus.APPROVED,
  REJECTED: StaffAccessRequestStatus.REJECTED,

  REVOKED: StaffAccessRequestStatus.REVOKED,
} as const;

export type AdminAccessPendingState =
  (typeof ADMIN_ACCESS_PENDING_STATES)[keyof typeof ADMIN_ACCESS_PENDING_STATES];
export type AdminAccessDecisionKind =
  (typeof ADMIN_ACCESS_DECISION_KINDS)[keyof typeof ADMIN_ACCESS_DECISION_KINDS];
export type AdminAccessRequestEffect =
  (typeof ADMIN_ACCESS_REQUEST_EFFECTS)[keyof typeof ADMIN_ACCESS_REQUEST_EFFECTS];

export type AdminAccessTableCurrentState = {
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly pendingState: AdminAccessPendingState;
};

export type AdminAccessTableDesiredState = {
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly decision: AdminAccessDecisionKind;
};

export type AdminAccessAllowedTransition = {
  readonly allowed: true;
  readonly status: 200;
  readonly code: null;
  readonly requestEffect: AdminAccessRequestEffect;
  readonly requiresCompleteProfile: boolean;
  readonly requiresSelfDeactivationGuard: boolean;
  readonly requiresLastActiveAdminGuard: boolean;
};

export type AdminAccessDeniedTransition = {
  readonly allowed: false;
  readonly status: 400 | 409;
  readonly code:
    | RolesErrorCode.ACCESS_CHANGE_REQUIRED
    | RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED
    | RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED
    | RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION
    | RolesErrorCode.INDEPENDENT_AUTHORITY_REQUIRED;
};

export type AdminAccessTransitionOutcome =
  AdminAccessAllowedTransition | AdminAccessDeniedTransition;

export type AdminAccessTransitionTableEntry = {
  readonly key: string;
  readonly current: AdminAccessTableCurrentState;
  readonly desired: AdminAccessTableDesiredState;
  readonly outcome: AdminAccessTransitionOutcome;
};

const ROLES = [null, 'STUDENT', 'STAFF', 'ADMIN'] as const;
const ACCOUNT_STATUSES = [
  AccountStatus.ACTIVE,
  AccountStatus.DEACTIVATED,
] as const;
const PENDING_STATES = [
  ADMIN_ACCESS_PENDING_STATES.NONE,
  ADMIN_ACCESS_PENDING_STATES.PENDING,
] as const;
const DECISIONS = [
  ADMIN_ACCESS_DECISION_KINDS.NONE,
  ADMIN_ACCESS_DECISION_KINDS.APPROVE,
  ADMIN_ACCESS_DECISION_KINDS.REJECT,
] as const;

export const ADMIN_ACCESS_TRANSITION_TABLE: readonly AdminAccessTransitionTableEntry[] =
  currentStates().flatMap((current) =>
    desiredStates().map((desired) => ({
      key: transitionKey(current, desired),
      current,
      desired,
      outcome: classifyTransition(current, desired),
    })),
  );

const TRANSITIONS_BY_KEY = new Map(
  ADMIN_ACCESS_TRANSITION_TABLE.map((entry) => [entry.key, entry]),
);

export class MissingAdminAccessTransitionError extends Error {
  constructor(key: string) {
    super(`Missing ADMIN access transition table entry: ${key}`);
    this.name = 'MissingAdminAccessTransitionError';
  }
}

export function resolveAdminAccessTransition(
  current: AdminAccessTableCurrentState,
  desired: AdminAccessTableDesiredState,
): AdminAccessTransitionTableEntry {
  const key = transitionKey(current, desired);
  const entry = TRANSITIONS_BY_KEY.get(key);
  if (!entry) {
    throw new MissingAdminAccessTransitionError(key);
  }
  return entry;
}

function currentStates(): readonly AdminAccessTableCurrentState[] {
  return ROLES.flatMap((role) =>
    ACCOUNT_STATUSES.flatMap((accountStatus) =>
      PENDING_STATES.map((pendingState) => ({
        role,
        accountStatus,
        pendingState,
      })),
    ),
  );
}

function desiredStates(): readonly AdminAccessTableDesiredState[] {
  return ROLES.flatMap((role) =>
    ACCOUNT_STATUSES.flatMap((accountStatus) =>
      DECISIONS.map((decision) => ({ role, accountStatus, decision })),
    ),
  );
}

function classifyTransition(
  current: AdminAccessTableCurrentState,
  desired: AdminAccessTableDesiredState,
): AdminAccessTransitionOutcome {
  if (current.role !== null && desired.role === null && !isRevocable(current)) {
    return denied(RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED, 409);
  }
  const changesRole = current.role !== desired.role;
  const changesAccountStatus = current.accountStatus !== desired.accountStatus;
  if (changesRole && changesAccountStatus) {
    return denied(RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED, 409);
  }
  const changesAccessState = changesRole || changesAccountStatus;

  if (current.pendingState === ADMIN_ACCESS_PENDING_STATES.NONE) {
    if (desired.decision !== ADMIN_ACCESS_DECISION_KINDS.NONE) {
      return denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400);
    }
    if (!changesAccessState) {
      return denied(RolesErrorCode.ACCESS_CHANGE_REQUIRED, 400);
    }
    if (isLegacyDisplayRoleLowering(current.role, desired.role)) {
      return denied(RolesErrorCode.INDEPENDENT_AUTHORITY_REQUIRED, 400);
    }
    return allowed(current, desired, directRequestEffect(current, desired));
  }

  switch (desired.decision) {
    case ADMIN_ACCESS_DECISION_KINDS.NONE:
      return changesAccessState
        ? denied(RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED, 409)
        : denied(RolesErrorCode.ACCESS_CHANGE_REQUIRED, 400);
    case ADMIN_ACCESS_DECISION_KINDS.APPROVE:
      return isStaffOnlyAccess(desired.role) &&
        desired.accountStatus === AccountStatus.ACTIVE
        ? allowed(current, desired, ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED)
        : denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400);
    case ADMIN_ACCESS_DECISION_KINDS.REJECT:
      return !isStaffOnlyAccess(current.role) && isStaffOnlyAccess(desired.role)
        ? denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400)
        : allowed(current, desired, ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED);
    default: {
      const unsupportedDecision: never = desired.decision;
      throw new MissingAdminAccessTransitionError(unsupportedDecision);
    }
  }
}

function isLegacyDisplayRoleLowering(
  currentRole: AuthorityLabel | null,
  desiredRole: AuthorityLabel | null,
): boolean {
  if (currentRole === 'ADMIN') {
    return desiredRole === 'STAFF' || desiredRole === 'STUDENT';
  }
  return currentRole === 'STAFF' && desiredRole === 'STUDENT';
}

function isRevocable(current: AdminAccessTableCurrentState): boolean {
  return (
    isStaffOnlyAccess(current.role) &&
    current.pendingState === ADMIN_ACCESS_PENDING_STATES.NONE
  );
}

function directRequestEffect(
  current: AdminAccessTableCurrentState,
  desired: AdminAccessTableDesiredState,
): AdminAccessRequestEffect {
  return isStaffOnlyAccess(current.role) && desired.role === null
    ? ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED
    : ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED;
}

function allowed(
  current: AdminAccessTableCurrentState,
  desired: AdminAccessTableDesiredState,
  requestEffect: AdminAccessRequestEffect,
): AdminAccessAllowedTransition {
  return {
    allowed: true,
    status: 200,
    code: null,
    requestEffect,
    requiresCompleteProfile:
      requestEffect === ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED,
    requiresSelfDeactivationGuard:
      current.accountStatus === AccountStatus.ACTIVE &&
      desired.accountStatus === AccountStatus.DEACTIVATED,
    requiresLastActiveAdminGuard:
      accessAuthorityOfRole(current.role).hasAdminAccess &&
      current.accountStatus === AccountStatus.ACTIVE &&
      (!accessAuthorityOfRole(desired.role).hasAdminAccess ||
        desired.accountStatus !== AccountStatus.ACTIVE),
  };
}

function denied(
  code: AdminAccessDeniedTransition['code'],
  status: AdminAccessDeniedTransition['status'],
): AdminAccessDeniedTransition {
  return { allowed: false, status, code };
}

function transitionKey(
  current: AdminAccessTableCurrentState,
  desired: AdminAccessTableDesiredState,
): string {
  return [
    current.role ?? 'UNASSIGNED',
    current.accountStatus,
    current.pendingState,
    desired.role ?? 'UNASSIGNED',
    desired.accountStatus,
    desired.decision,
  ].join('|');
}
