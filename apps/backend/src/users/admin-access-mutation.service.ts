import type { AuthorityLabel } from './authority-label.types';
import {
  MissingAdminAccessTransitionError,
  InvalidAdminAccessAuditError,
  PendingRequestDecisionConflict,
} from './admin-access-mutation.error';
import { StaffAccessRequestStatus, AccountStatus } from '@prisma/client';
import type { AuditLogService } from '../platform/audit-log.service';
import { RolesErrorCode, ROLES_ERROR_CODES } from './roles-error-code.error';
import type {
  AdminAccessRepositoryPort,
  AdminAccessTransactionStore,
  AdminAccessUserRow,
  AdminAccessUserDetailRow,
  AdminAccessUserDetailRecord,
} from './admin-access-read.repository';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
} from '../platform/audit-log-metadata.config';
import type { AccessAuditAction } from '../platform/audit-log.repository';
import type { AccessAuditMetadata } from '../platform/audit-log-metadata.config';
import {
  type AdminAccessActor,
  type AdminAccessUserRecord,
} from './admin-access-read.repository';
import { DomainException } from '../platform/error-code.error';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.error';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import { AdminAccessPendingRequest } from './admin-access-read-ordering.repository';
import { ADMIN_ACCESS_REQUEST_DECISIONS } from './admin-access-query.config';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { Injectable } from '@nestjs/common';
import { UserProfileService } from '../platform/user-profile.service';

export type AdminAccessRequestDecision =
  | {
      readonly decision: typeof ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE;
    }
  | {
      readonly decision: typeof ADMIN_ACCESS_REQUEST_DECISIONS.REJECT;
      readonly reason: string;
    };

export type AdminAccessExpectedPendingRequest = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
};

export type AdminAccessMutationCommand = {
  readonly expectedRole: AuthorityLabel | null;
  readonly desiredRole: AuthorityLabel | null;
  readonly expectedAccountStatus: AccountStatus;
  readonly desiredAccountStatus: AccountStatus;
  readonly expectedPendingRequest: AdminAccessExpectedPendingRequest | null;
  readonly requestDecision?: AdminAccessRequestDecision;

  readonly expectedHasStaffAccess?: boolean;
  readonly expectedHasAdminAccess?: boolean;
};

type AdminAccessCasProjection = {
  readonly id: string;
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly pendingRequest: AdminAccessPendingRequest | null;
};

type AdminAccessDecidedRequest = {
  readonly id: string;
  readonly status:
    | typeof StaffAccessRequestStatus.APPROVED
    | typeof StaffAccessRequestStatus.REJECTED
    | typeof StaffAccessRequestStatus.REVOKED;
};

export type AdminAccessMutationResult = AdminAccessCasProjection & {
  readonly decidedRequest: AdminAccessDecidedRequest | null;
};

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

function isStaffOnlyAccess(role: AuthorityLabel | null): boolean {
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

type AdminAccessPendingState =
  (typeof ADMIN_ACCESS_PENDING_STATES)[keyof typeof ADMIN_ACCESS_PENDING_STATES];

type AdminAccessDecisionKind =
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

type AdminAccessAllowedTransition = {
  readonly allowed: true;
  readonly status: 200;
  readonly code: null;
  readonly requestEffect: AdminAccessRequestEffect;
  readonly requiresCompleteProfile: boolean;
  readonly requiresSelfDeactivationGuard: boolean;
  readonly requiresLastActiveAdminGuard: boolean;
};

type AdminAccessDeniedTransition = {
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

type AdminAccessAudit = {
  readonly action: AccessAuditAction;
  readonly targetType: 'USER' | 'ROLE_REQUEST';
  readonly targetId: string;
  readonly metadata: AccessAuditMetadata;
};

function assertNeverForAdminAccessAudit(value: never): never {
  void value;
  throw new InvalidAdminAccessAuditError();
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

export type AuthorityWrite = {
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

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

function toAdminAccessDecisionKind(
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

const ADMIN_ACCESS_REQUEST_WRITE_KINDS = {
  NONE: 'NONE',
  DECIDE_PENDING: 'DECIDE_PENDING',
  INSERT_REVOKED: 'INSERT_REVOKED',
} as const;

type AdminAccessRequestWrite =
  | { readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.NONE }
  | {
      readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.DECIDE_PENDING;
      readonly requestId: string;
      readonly nextStatus:
        | typeof StaffAccessRequestStatus.APPROVED
        | typeof StaffAccessRequestStatus.REJECTED;
    }
  | { readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.INSERT_REVOKED };

function assertNeverForAdminAccessMutation(value: never): never {
  throw new TypeError(`Unsupported admin access variant: ${String(value)}`);
}

type MutationDependencies = {
  readonly repository: AdminAccessRepositoryPort;
  readonly auditLog: AuditLogService;
};

type MutationInput = {
  readonly actorGithubId: bigint;
  readonly userId: string;
  readonly command: AdminAccessMutationCommand;
};

const USER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export interface AdminAccessPatchRequest {
  readonly expectedRole: string | null;
  readonly desiredRole: string | null;
  readonly expectedAccountStatus: string;
  readonly desiredAccountStatus: string;
  readonly expectedHasStaffAccess?: boolean;
  readonly expectedHasAdminAccess?: boolean;
  readonly expectedPendingRequest: {
    readonly id: string;
    readonly status: string;
  } | null;
  readonly requestDecision?: {
    readonly decision: string;
    readonly reason?: string;
  };
}

@Injectable()
export class AdminAccessMutationService {
  constructor(
    private readonly auditLogMetadataService: AuditLogMetadataService,
    private readonly userProfileService: UserProfileService,
  ) {}

  async mutateAdminAccess(
    dependencies: MutationDependencies,
    input: MutationInput,
  ): Promise<AdminAccessMutationResult> {
    try {
      return await dependencies.repository.withTransaction(async (store) => {
        const unlockedActor = this.requireActiveStaffOrAdmin(
          await store.findActorByGithubId(input.actorGithubId),
        );
        this.assertAccessMutationAllowed(
          unlockedActor,
          input.userId,
          input.command,
        );

        const activeAdminCount = this.isAdminActor(unlockedActor)
          ? await store.lockActiveAdmins()
          : Number.MAX_SAFE_INTEGER;
        const actor = this.isAdminActor(unlockedActor)
          ? this.requireActiveAdmin(
              await store.findActorByGithubId(input.actorGithubId),
            )
          : this.requireActiveStaffOrAdmin(
              await store.findActorByGithubId(input.actorGithubId),
            );
        this.assertAccessMutationAllowed(actor, input.userId, input.command);
        const beforeRow = await store.findUserForUpdate(input.userId);
        const before = beforeRow
          ? this.toAdminAccessUserRecord(beforeRow)
          : null;
        if (!before) {
          throw this.roleError(RolesErrorCode.USER_NOT_FOUND);
        }
        if (!this.matchesExpectedAccessState(before, input.command)) {
          throw this.staleAccessError(before);
        }

        const transition = this.resolveAdminAccessTransition(
          {
            role: before.role,
            accountStatus: before.accountStatus,
            pendingState: before.pendingRequest
              ? ADMIN_ACCESS_PENDING_STATES.PENDING
              : ADMIN_ACCESS_PENDING_STATES.NONE,
          },
          {
            role: input.command.desiredRole,
            accountStatus: input.command.desiredAccountStatus,
            decision: toAdminAccessDecisionKind(input.command),
          },
        );
        if (!transition.outcome.allowed) {
          throw this.roleError(transition.outcome.code);
        }
        this.enforceAdminAccessGuards(
          actor,
          before,
          input.command,
          transition.outcome,
          activeAdminCount,
        );

        const authority = this.authorityAfterLegacyTransition(
          before,
          input.command,
          transition.outcome.requestEffect,
        );
        const userUpdated = await store.compareAndSwapAccess({
          userId: input.userId,
          expectedHasStaffAccess:
            input.command.expectedHasStaffAccess ?? before.hasStaffAccess,
          expectedHasAdminAccess:
            input.command.expectedHasAdminAccess ?? before.hasAdminAccess,
          expectedAccountStatus: input.command.expectedAccountStatus,
          desiredAccountStatus: input.command.desiredAccountStatus,
          desiredHasStaffAccess: authority.hasStaffAccess,
          desiredHasAdminAccess: authority.hasAdminAccess,
        });
        if (!userUpdated) {
          throw this.staleAccessError(before);
        }

        const result = await this.decideRequestAndBuildResult(
          store,
          actor,
          before,
          input.command,
          transition.outcome.requestEffect,
        );
        const audit = this.createAdminAccessAudit({
          actor,
          before,
          command: input.command,
          result,
          requestEffect: transition.outcome.requestEffect,
        });
        await dependencies.auditLog.record(
          {
            actorGithubId: input.actorGithubId,
            action: audit.action,
            targetType: audit.targetType,
            targetId: audit.targetId,
            metadata: audit.metadata,
          },
          store.auditLogWriter,
        );
        return result;
      });
    } catch (error: unknown) {
      if (!(error instanceof PendingRequestDecisionConflict)) {
        throw error;
      }
      const current = await dependencies.repository.findById(input.userId);
      if (!current) {
        throw this.roleError(RolesErrorCode.USER_NOT_FOUND);
      }
      throw this.staleAccessError(this.toAdminAccessUserRecord(current));
    }
  }

  requireValidUserId(id: string): void {
    if (id === 'me' || !USER_ID_PATTERN.test(id)) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ID],
      );
    }
  }

  commandFromPatchAccessRequest(
    request: AdminAccessPatchRequest,
  ): AdminAccessMutationCommand {
    return {
      expectedRole: this.parsePatchRole(request.expectedRole),
      desiredRole: this.parsePatchRole(request.desiredRole),
      expectedAccountStatus: this.parsePatchAccountStatus(
        request.expectedAccountStatus,
      ),
      desiredAccountStatus: this.parsePatchAccountStatus(
        request.desiredAccountStatus,
      ),
      expectedPendingRequest:
        request.expectedPendingRequest === null
          ? null
          : this.parseExpectedPendingRequest(request.expectedPendingRequest),
      ...this.parseExpectedCanonicalAuthority(request),
      ...(request.requestDecision
        ? {
            requestDecision: this.parseRequestDecision(request.requestDecision),
          }
        : {}),
    };
  }

  private parseExpectedPendingRequest(request: {
    readonly id: string;
    readonly status: string;
  }): AdminAccessExpectedPendingRequest {
    if (request.status !== StaffAccessRequestStatus.PENDING) {
      throw this.invalidAccessRequestDecision();
    }
    return { id: request.id, status: StaffAccessRequestStatus.PENDING };
  }

  private parseRequestDecision(request: {
    readonly decision: string;
    readonly reason?: string;
  }): AdminAccessRequestDecision {
    switch (request.decision) {
      case ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE:
        return { decision: ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE };
      case ADMIN_ACCESS_REQUEST_DECISIONS.REJECT: {
        const reason = request.reason?.trim();
        if (!reason) {
          throw new DomainException(
            ROLES_ERROR_CODES[RolesErrorCode.REJECTION_REASON_REQUIRED],
          );
        }
        return { decision: ADMIN_ACCESS_REQUEST_DECISIONS.REJECT, reason };
      }
      default:
        throw this.invalidAccessRequestDecision();
    }
  }

  private parseExpectedCanonicalAuthority(request: {
    readonly expectedHasStaffAccess?: boolean;
    readonly expectedHasAdminAccess?: boolean;
  }): Pick<
    AdminAccessMutationCommand,
    'expectedHasStaffAccess' | 'expectedHasAdminAccess'
  > {
    const hasStaff = request.expectedHasStaffAccess;
    const hasAdmin = request.expectedHasAdminAccess;
    if (hasStaff === undefined && hasAdmin === undefined) {
      return {};
    }
    if (typeof hasStaff !== 'boolean' || typeof hasAdmin !== 'boolean') {
      throw this.invalidAccessRequestDecision();
    }
    return {
      expectedHasStaffAccess: hasStaff,
      expectedHasAdminAccess: hasAdmin,
    };
  }

  private parsePatchRole(value: string | null): AuthorityLabel | null {
    switch (value) {
      case null:
        return null;
      case 'STUDENT':
      case 'STAFF':
      case 'ADMIN':
        return value;
      default:
        throw new DomainException(
          ROLES_ERROR_CODES[RolesErrorCode.INVALID_USER_ROLE],
        );
    }
  }

  private parsePatchAccountStatus(value: string): AccountStatus {
    switch (value) {
      case AccountStatus.ACTIVE:
      case AccountStatus.DEACTIVATED:
        return value;
      default:
        throw this.invalidAccessRequestDecision();
    }
  }

  private invalidAccessRequestDecision(): DomainException {
    return new DomainException(
      ROLES_ERROR_CODES[RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION],
    );
  }

  toAdminAccessUserRecord(row: AdminAccessUserRow): AdminAccessUserRecord {
    const { selectedMemberKind, studentId, department, ...record } = row;
    return {
      ...record,
      role: this.userProfileService.authorityLabel(row),
      isProfileComplete: this.userProfileService.isCompleteUserProfile({
        id: row.id,
        name: row.name,
        studentId,
        department,
        memberKind: row.memberKind,
        hasPendingStaffRequest: row.pendingRequest !== null,
        selectedMemberKind,
      }),
    };
  }

  toAdminAccessUserDetailRecord(
    row: AdminAccessUserDetailRow,
  ): AdminAccessUserDetailRecord {
    const { staffNumber, ...user } = row;
    const record = this.toAdminAccessUserRecord(user);
    return {
      ...record,
      profile: {
        name: row.name,
        studentId: row.studentId,
        department: row.department,
        staffNumber,
        isComplete: record.isProfileComplete,
      },
    };
  }

  private createAdminAccessAudit(input: {
    readonly actor: AdminAccessActor;
    readonly before: AdminAccessUserRecord;
    readonly command: AdminAccessMutationCommand;
    readonly result: AdminAccessMutationResult;
    readonly requestEffect: AdminAccessRequestEffect;
  }): AdminAccessAudit {
    const common = {
      actor: {
        displayName: input.actor.name,
        githubLogin: input.actor.githubLogin,
      },

      target: {
        displayName: input.before.name,
        githubLogin: input.before.githubLogin,
      },
      before: {
        role: input.before.role,
        accountStatus: input.before.accountStatus,
        requestStatus: input.before.pendingRequest?.status ?? null,
      },
      after: {
        role: input.result.role,
        accountStatus: input.result.accountStatus,
        requestStatus: input.result.decidedRequest?.status ?? null,
      },
    };
    switch (input.requestEffect) {
      case ADMIN_ACCESS_REQUEST_EFFECTS.APPROVED: {
        const requestId = input.before.pendingRequest?.id;
        if (!requestId) {
          throw new InvalidAdminAccessAuditError();
        }
        return {
          action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_APPROVED,
          targetType: 'ROLE_REQUEST',
          targetId: requestId,
          metadata: this.auditLogMetadataService.createAccessAuditMetadata({
            ...common,
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_APPROVED,
          }),
        };
      }
      case ADMIN_ACCESS_REQUEST_EFFECTS.REJECTED: {
        const requestId = input.before.pendingRequest?.id;
        const decision = input.command.requestDecision;
        if (
          !requestId ||
          decision?.decision !== ADMIN_ACCESS_REQUEST_DECISIONS.REJECT
        ) {
          throw new InvalidAdminAccessAuditError();
        }
        return {
          action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REJECTED,
          targetType: 'ROLE_REQUEST',
          targetId: requestId,
          metadata: this.auditLogMetadataService.createAccessAuditMetadata({
            ...common,
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
            rejectionReason: decision.reason,
          }),
        };
      }
      case ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED: {
        const decidedRequest = input.result.decidedRequest;
        if (decidedRequest?.status !== StaffAccessRequestStatus.REVOKED) {
          throw new InvalidAdminAccessAuditError();
        }
        return {
          action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
          targetType: 'ROLE_REQUEST',
          targetId: decidedRequest.id,
          metadata: this.auditLogMetadataService.createAccessAuditMetadata({
            ...common,
            eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
          }),
        };
      }
      case ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED:
        return this.createDirectAccessAudit(input, common);
      default:
        return assertNeverForAdminAccessAudit(input.requestEffect);
    }
  }

  private createDirectAccessAudit(
    input: {
      readonly before: AdminAccessUserRecord;
      readonly result: AdminAccessMutationResult;
    },
    common: {
      readonly actor: {
        readonly displayName: string | null;
        readonly githubLogin: string;
      };
      readonly target: {
        readonly displayName: string | null;
        readonly githubLogin: string;
      };
      readonly before: {
        readonly role: AdminAccessUserRecord['role'];
        readonly accountStatus: AdminAccessUserRecord['accountStatus'];
        readonly requestStatus: typeof StaffAccessRequestStatus.PENDING | null;
      };
      readonly after: {
        readonly role: AdminAccessMutationResult['role'];
        readonly accountStatus: AdminAccessMutationResult['accountStatus'];
        readonly requestStatus:
          | typeof StaffAccessRequestStatus.APPROVED
          | typeof StaffAccessRequestStatus.REJECTED
          | typeof StaffAccessRequestStatus.REVOKED
          | null;
      };
    },
  ): AdminAccessAudit {
    if (input.before.role !== input.result.role) {
      return {
        action: ACCESS_AUDIT_ACTIONS.DIRECT_ROLE_CHANGED,
        targetType: 'USER',
        targetId: input.before.id,
        metadata: this.auditLogMetadataService.createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.DIRECT_ROLE_CHANGED,
        }),
      };
    }
    if (input.before.accountStatus !== input.result.accountStatus) {
      return {
        action: ACCESS_AUDIT_ACTIONS.ACCOUNT_STATUS_CHANGED,
        targetType: 'USER',
        targetId: input.before.id,
        metadata: this.auditLogMetadataService.createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED,
        }),
      };
    }
    throw new InvalidAdminAccessAuditError();
  }

  resolveAdminAccessTransition(
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

  requireActiveAdmin(actor: AdminAccessActor | null): AdminAccessActor {
    if (!actor || actor.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    if (!actor.hasAdminAccess) {
      throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
    }
    return actor;
  }

  requireActiveStaffOrAdmin(actor: AdminAccessActor | null): AdminAccessActor {
    if (!actor || actor.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
      );
    }
    if (!actor.hasStaffAccess && !actor.hasAdminAccess) {
      throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
    }
    return actor;
  }

  isAdminActor(actor: AdminAccessActor): boolean {
    return actor.hasAdminAccess;
  }

  assertAccessMutationAllowed(
    actor: AdminAccessActor,
    targetUserId: string,
    command: AdminAccessMutationCommand,
  ): void {
    if (actor.id === targetUserId && isRequestDecisionCommand(command)) {
      throw new DomainException(
        ROLES_ERROR_CODES[RolesErrorCode.SELF_ACCESS_MUTATION_FORBIDDEN],
      );
    }
    if (this.isAdminActor(actor)) {
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

  authorityAfterLegacyTransition(
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

  matchesExpectedAccessState(
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

  enforceAdminAccessGuards(
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
      throw this.roleError(RolesErrorCode.ADMIN_ONLY);
    }
    if (outcome.requiresSelfDeactivationGuard && actor.id === before.id) {
      throw this.roleError(RolesErrorCode.SELF_DEACTIVATION_FORBIDDEN);
    }
    if (
      outcome.requiresLastActiveAdminGuard &&
      (activeAdminCount === null || activeAdminCount <= 1)
    ) {
      throw this.roleError(RolesErrorCode.LAST_ACTIVE_ADMIN_REQUIRED);
    }
    if (outcome.requiresCompleteProfile && !before.isProfileComplete) {
      throw new DomainException(
        USERS_ERROR_CODES[UsersErrorCode.PROFILE_INCOMPLETE],
      );
    }
  }

  private toAdminAccessRequestWrite(
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
          throw this.staleAccessError(before);
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

  roleError(code: RolesErrorCode): DomainException {
    return new DomainException(ROLES_ERROR_CODES[code]);
  }

  staleAccessError(
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

  private async decideRequestAndBuildResult(
    store: AdminAccessTransactionStore,
    actor: AdminAccessActor,
    before: AdminAccessUserRecord,
    command: AdminAccessMutationCommand,
    requestEffect: AdminAccessRequestEffect,
  ): Promise<AdminAccessMutationResult> {
    const decidedRequest = await applyRequestWrite(
      store,
      actor,
      before,
      command,
      this.toAdminAccessRequestWrite(before, requestEffect),
    );
    return {
      id: before.id,
      role: command.desiredRole,
      accountStatus: command.desiredAccountStatus,
      pendingRequest: decidedRequest ? null : before.pendingRequest,
      decidedRequest,
    };
  }
}

async function applyRequestWrite(
  store: AdminAccessTransactionStore,
  actor: AdminAccessActor,
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
  write: AdminAccessRequestWrite,
): Promise<AdminAccessMutationResult['decidedRequest']> {
  switch (write.kind) {
    case ADMIN_ACCESS_REQUEST_WRITE_KINDS.NONE:
      return null;
    case ADMIN_ACCESS_REQUEST_WRITE_KINDS.DECIDE_PENDING: {
      const decision = command.requestDecision;
      const requestUpdated = await store.decidePendingRequest({
        requestId: write.requestId,
        actorId: actor.id,
        nextStatus: write.nextStatus,
        rejectionReason:
          decision?.decision === ADMIN_ACCESS_REQUEST_DECISIONS.REJECT
            ? decision.reason
            : null,
        decidedAt: new Date(),
      });
      if (!requestUpdated) {
        throw new PendingRequestDecisionConflict();
      }
      return { id: write.requestId, status: write.nextStatus };
    }
    case ADMIN_ACCESS_REQUEST_WRITE_KINDS.INSERT_REVOKED: {
      const inserted = await store.insertRevokedRequest({
        userId: before.id,
        actorId: actor.id,
        decidedAt: new Date(),
      });
      return { id: inserted.id, status: StaffAccessRequestStatus.REVOKED };
    }
    default:
      return assertNever(write);
  }
}

function assertNever(value: never): never {
  throw new TypeError(
    `Unsupported admin access request write: ${String(value)}`,
  );
}
