import { AccountStatus, Role } from '@prisma/client';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import {
  ADMIN_ACCESS_DECISION_KINDS,
  ADMIN_ACCESS_PENDING_STATES,
  ADMIN_ACCESS_REQUEST_EFFECTS,
  type AdminAccessTableCurrentState,
  type AdminAccessTableDesiredState,
  type AdminAccessTransitionOutcome,
} from './admin-access-transition-table';

export type AdminAccessTransitionFixture = {
  readonly name: string;
  readonly current: AdminAccessTableCurrentState;
  readonly desired: AdminAccessTableDesiredState;
  readonly expected: AdminAccessTransitionOutcome;
};

export const ADMIN_ACCESS_TRANSITION_FIXTURES = [
  {
    name: 'unchanged access without a request is rejected',
    current: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: false,
      status: 400,
      code: RolesErrorCode.ACCESS_CHANGE_REQUIRED,
    },
  },
  {
    name: 'a decision without a pending request is rejected',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.APPROVE,
    },
    expected: {
      allowed: false,
      status: 400,
      code: RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION,
    },
  },
  {
    name: 'a confirmed role cannot return to unassigned',
    current: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: false,
      status: 409,
      code: RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
    },
  },
  {
    name: 'role and account status cannot change in one direct mutation',
    current: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.DEACTIVATED,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: false,
      status: 409,
      code: RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
    },
  },
  {
    name: 'a direct role-only grant is allowed without a pending request',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
      requiresCompleteProfile: false,
      requiresSelfDeactivationGuard: false,
      requiresLastActiveAdminGuard: false,
    },
  },
  {
    name: 'deactivation preserves role and enables the self guard',
    current: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.DEACTIVATED,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
      requiresCompleteProfile: false,
      requiresSelfDeactivationGuard: true,
      requiresLastActiveAdminGuard: false,
    },
  },
  {
    name: 'admin demotion enables the final-admin guard',
    current: {
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
      requiresCompleteProfile: false,
      requiresSelfDeactivationGuard: false,
      requiresLastActiveAdminGuard: true,
    },
  },
  {
    name: 'admin deactivation enables both contextual guards',
    current: {
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.ADMIN,
      accountStatus: AccountStatus.DEACTIVATED,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
      requiresCompleteProfile: false,
      requiresSelfDeactivationGuard: true,
      requiresLastActiveAdminGuard: true,
    },
  },
  {
    name: 'reactivation preserves role',
    current: {
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
      pendingState: ADMIN_ACCESS_PENDING_STATES.NONE,
    },
    desired: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED,
      requiresCompleteProfile: false,
      requiresSelfDeactivationGuard: false,
      requiresLastActiveAdminGuard: false,
    },
  },
  {
    name: 'an unchanged pending request still needs an operation',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: false,
      status: 400,
      code: RolesErrorCode.ACCESS_CHANGE_REQUIRED,
    },
  },
  {
    name: 'a pending request requires an explicit decision before a direct change',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.NONE,
    },
    expected: {
      allowed: false,
      status: 409,
      code: RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED,
    },
  },
  {
    name: 'approval grants active staff and requires a complete profile',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.APPROVE,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED,
      requiresCompleteProfile: true,
      requiresSelfDeactivationGuard: false,
      requiresLastActiveAdminGuard: false,
    },
  },
  {
    name: 'approval cannot grant a non-staff role',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.APPROVE,
    },
    expected: {
      allowed: false,
      status: 400,
      code: RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION,
    },
  },
  {
    name: 'approval cannot produce a deactivated staff account',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: Role.STAFF,
      accountStatus: AccountStatus.DEACTIVATED,
      decision: ADMIN_ACCESS_DECISION_KINDS.APPROVE,
    },
    expected: {
      allowed: false,
      status: 409,
      code: RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
    },
  },
  {
    name: 'rejection may preserve the current active access state',
    current: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.REJECT,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED,
      requiresCompleteProfile: false,
      requiresSelfDeactivationGuard: false,
      requiresLastActiveAdminGuard: false,
    },
  },
  {
    name: 'rejection and deactivation are one documented compound operation that preserves role',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: null,
      accountStatus: AccountStatus.DEACTIVATED,
      decision: ADMIN_ACCESS_DECISION_KINDS.REJECT,
    },
    expected: {
      allowed: true,
      status: 200,
      code: null,
      requestEffect: ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED,
      requiresCompleteProfile: false,
      requiresSelfDeactivationGuard: true,
      requiresLastActiveAdminGuard: false,
    },
  },
  {
    name: 'rejection cannot grant staff to a non-staff user',
    current: {
      role: null,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      decision: ADMIN_ACCESS_DECISION_KINDS.REJECT,
    },
    expected: {
      allowed: false,
      status: 400,
      code: RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION,
    },
  },
  {
    name: 'rejection cannot combine a role change and deactivation',
    current: {
      role: Role.STAFF,
      accountStatus: AccountStatus.ACTIVE,
      pendingState: ADMIN_ACCESS_PENDING_STATES.PENDING,
    },
    desired: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.DEACTIVATED,
      decision: ADMIN_ACCESS_DECISION_KINDS.REJECT,
    },
    expected: {
      allowed: false,
      status: 409,
      code: RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED,
    },
  },
] as const satisfies readonly AdminAccessTransitionFixture[];
