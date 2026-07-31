import type { AuditLogService } from '../audit-log/audit-log.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { createAdminAccessAudit } from './admin-access-audit';
import { requireActiveAdmin } from './admin-access-authorization';
import {
  enforceAdminAccessGuards,
  matchesExpectedAccessState,
  roleError,
  staleAccessError,
  toAdminAccessDecidedRequest,
  toAdminAccessDecisionKind,
} from './admin-access-mutation-policy';
import type {
  AdminAccessActor,
  AdminAccessRepositoryPort,
  AdminAccessTransactionStore,
  AdminAccessUserRecord,
} from './admin-access.repository';
import {
  ADMIN_ACCESS_PENDING_STATES,
  resolveAdminAccessTransition,
  type AdminAccessRequestEffect,
} from './admin-access-transition-table';
import {
  ADMIN_ACCESS_REQUEST_DECISIONS,
  type AdminAccessMutationCommand,
  type AdminAccessMutationResult,
} from './domain/admin-access';

type MutationDependencies = {
  readonly repository: AdminAccessRepositoryPort;
  readonly auditLog: AuditLogService;
};

type MutationInput = {
  readonly actorGithubId: bigint;
  readonly userId: string;
  readonly command: AdminAccessMutationCommand;
};

export async function mutateAdminAccess(
  dependencies: MutationDependencies,
  input: MutationInput,
): Promise<AdminAccessMutationResult> {
  try {
    return await dependencies.repository.withTransaction(async (store) => {
      const actor = requireActiveAdmin(
        await store.findActorByGithubId(input.actorGithubId),
      );
      const activeAdminCount = await store.lockActiveAdmins();
      const before = await store.findUserForUpdate(input.userId);
      if (!before) {
        throw roleError(RolesErrorCode.USER_NOT_FOUND);
      }
      if (!matchesExpectedAccessState(before, input.command)) {
        throw staleAccessError(before);
      }

      const transition = resolveAdminAccessTransition(
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
        throw roleError(transition.outcome.code);
      }
      enforceAdminAccessGuards(
        actor,
        before,
        transition.outcome,
        activeAdminCount,
      );

      const userUpdated = await store.compareAndSwapAccess({
        userId: input.userId,
        expectedRole: input.command.expectedRole,
        expectedAccountStatus: input.command.expectedAccountStatus,
        desiredRole: input.command.desiredRole,
        desiredAccountStatus: input.command.desiredAccountStatus,
      });
      if (!userUpdated) {
        throw staleAccessError(before);
      }

      const result = await decideRequestAndBuildResult(
        store,
        actor,
        before,
        input.command,
        transition.outcome.requestEffect,
      );
      const audit = createAdminAccessAudit({
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
      throw roleError(RolesErrorCode.USER_NOT_FOUND);
    }
    throw staleAccessError(current);
  }
}

async function decideRequestAndBuildResult(
  store: AdminAccessTransactionStore,
  actor: AdminAccessActor,
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
  requestEffect: AdminAccessRequestEffect,
): Promise<AdminAccessMutationResult> {
  const decidedRequest = toAdminAccessDecidedRequest(before, requestEffect);
  if (decidedRequest) {
    const decision = command.requestDecision;
    const requestUpdated = await store.decidePendingRequest({
      requestId: decidedRequest.id,
      actorId: actor.id,
      nextStatus: decidedRequest.status,
      rejectionReason:
        decision?.decision === ADMIN_ACCESS_REQUEST_DECISIONS.REJECT
          ? decision.reason
          : null,
      decidedAt: new Date(),
    });
    if (!requestUpdated) {
      throw new PendingRequestDecisionConflict();
    }
  }
  return {
    id: before.id,
    role: command.desiredRole,
    accountStatus: command.desiredAccountStatus,
    pendingRequest: decidedRequest ? null : before.pendingRequest,
    decidedRequest,
  };
}

class PendingRequestDecisionConflict extends Error {}
