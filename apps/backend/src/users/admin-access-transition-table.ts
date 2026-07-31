import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { RolesErrorCode } from '../roles/roles-error-code.enum';

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
  APPROVED: RoleRequestStatus.APPROVED,
  REJECTED: RoleRequestStatus.REJECTED,
} as const;

export type AdminAccessPendingState =
  (typeof ADMIN_ACCESS_PENDING_STATES)[keyof typeof ADMIN_ACCESS_PENDING_STATES];
export type AdminAccessDecisionKind =
  (typeof ADMIN_ACCESS_DECISION_KINDS)[keyof typeof ADMIN_ACCESS_DECISION_KINDS];
export type AdminAccessRequestEffect =
  (typeof ADMIN_ACCESS_REQUEST_EFFECTS)[keyof typeof ADMIN_ACCESS_REQUEST_EFFECTS];

export type AdminAccessTableCurrentState = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly pendingState: AdminAccessPendingState;
};

export type AdminAccessTableDesiredState = {
  readonly role: Role | null;
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
    | RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION;
};

export type AdminAccessTransitionOutcome =
  AdminAccessAllowedTransition | AdminAccessDeniedTransition;

export type AdminAccessTransitionTableEntry = {
  readonly key: string;
  readonly current: AdminAccessTableCurrentState;
  readonly desired: AdminAccessTableDesiredState;
  readonly outcome: AdminAccessTransitionOutcome;
};

const ROLES = [null, Role.STUDENT, Role.STAFF, Role.ADMIN] as const;
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

/**
 * Exhaustive transition contract (4 roles × 2 account states × 2 pending
 * states) × (4 desired roles × 2 desired account states × 3 decisions).
 *
 * | Current pending | Decision | Desired-state precondition | Outcome |
 * | --- | --- | --- | --- |
 * | none | none | role/status changes | allow |
 * | none | APPROVE/REJECT | — | ROL_016 / 400 |
 * | PENDING | none | no state change | ROL_019 / 400 |
 * | PENDING | none | any state change | ROL_015 / 409 |
 * | PENDING | APPROVE | STAFF + ACTIVE | approve atomically |
 * | PENDING | APPROVE | otherwise | ROL_016 / 400 |
 * | PENDING | REJECT | no contradictory direct STAFF grant | reject atomically |
 * | PENDING | REJECT | direct STAFF grant | ROL_016 / 400 |
 *
 * A non-null role cannot transition back to null (ROL_014 / 409). Contextual
 * self-deactivation and last-active-ADMIN guards are flags on allowed entries.
 */
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
  if (current.role !== null && desired.role === null) {
    return denied(RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED, 409);
  }
  const changesRole = current.role !== desired.role;
  const changesAccountStatus = current.accountStatus !== desired.accountStatus;
  if (changesRole && changesAccountStatus) {
    return denied(RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED, 409);
  }
  const changesAccessState = changesRole || changesAccountStatus;

  if (current.pendingState === ADMIN_ACCESS_PENDING_STATES.NONE) {
    return desired.decision === ADMIN_ACCESS_DECISION_KINDS.NONE
      ? changesAccessState
        ? allowed(current, desired, ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED)
        : denied(RolesErrorCode.ACCESS_CHANGE_REQUIRED, 400)
      : denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400);
  }

  switch (desired.decision) {
    case ADMIN_ACCESS_DECISION_KINDS.NONE:
      return changesAccessState
        ? denied(RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED, 409)
        : denied(RolesErrorCode.ACCESS_CHANGE_REQUIRED, 400);
    case ADMIN_ACCESS_DECISION_KINDS.APPROVE:
      return desired.role === Role.STAFF &&
        desired.accountStatus === AccountStatus.ACTIVE
        ? allowed(current, desired, ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED)
        : denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400);
    case ADMIN_ACCESS_DECISION_KINDS.REJECT:
      return current.role !== Role.STAFF && desired.role === Role.STAFF
        ? denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400)
        : allowed(current, desired, ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED);
    default: {
      const unsupportedDecision: never = desired.decision;
      throw new MissingAdminAccessTransitionError(unsupportedDecision);
    }
  }
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
      current.role === Role.ADMIN &&
      current.accountStatus === AccountStatus.ACTIVE &&
      (desired.role !== Role.ADMIN ||
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
