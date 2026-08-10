import { RoleRequestStatus } from '@prisma/client';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { createAdminAccessAudit } from './admin-access-audit';
import { requireActiveAdmin } from './admin-access-authorization';
import {
  ADMIN_ACCESS_REQUEST_WRITE_KINDS,
  enforceAdminAccessGuards,
  matchesExpectedAccessState,
  roleError,
  staleAccessError,
  toAdminAccessDecisionKind,
  toAdminAccessRequestWrite,
  type AdminAccessRequestWrite,
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
      requireActiveAdmin(await store.findActorByGithubId(input.actorGithubId));
      const activeAdminCount = await store.lockActiveAdmins();
      // 위 읽기는 잠금 이전의 unlocked read라 TOCTOU 창이 있다: 이 시점과 lockActiveAdmins()
      // 사이에 actor가 강등/비활성화되어 커밋되면 그 사실을 놓친 채 오래된 actor로 뮤테이션이
      // 완주할 수 있다. lockActiveAdmins()가 ADMIN+ACTIVE 행을 FOR UPDATE로 잠근 "뒤"
      // actor를 다시 읽어 재검증하면 두 경우 모두 안전하다: (a) 강등이 이미 커밋됐다면 이
      // 재조회가 그 커밋을 그대로 보고 requireActiveAdmin이 던진다. (b) 아직 커밋 전이라면
      // actor 행(여전히 ADMIN+ACTIVE)이 lockActiveAdmins()에 의해 FOR UPDATE로 잠겨 있으므로
      // 강등 트랜잭션의 UPDATE는 이 트랜잭션이 끝날 때까지 블록되고, 이 뮤테이션이 강등보다
      // 먼저 유효하게 직렬화된다.
      const actor = requireActiveAdmin(
        await store.findActorByGithubId(input.actorGithubId),
      );
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
  const decidedRequest = await applyRequestWrite(
    store,
    actor,
    before,
    command,
    toAdminAccessRequestWrite(before, requestEffect),
  );
  return {
    id: before.id,
    role: command.desiredRole,
    accountStatus: command.desiredAccountStatus,
    pendingRequest: decidedRequest ? null : before.pendingRequest,
    decidedRequest,
  };
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
      // 역할을 비운 compare-and-swap과 **같은 트랜잭션**에서 넣는다. 두 쓰기가 갈리면
      // "역할은 비었는데 회수 이력은 없는" 순간이 커밋 사이에 노출되고, 그 순간에 로그인이
      // 끼면 시드가 권한을 되살린다(`auth.repository.ts`의 회수 이력 조건).
      const inserted = await store.insertRevokedRequest({
        userId: before.id,
        actorId: actor.id,
        decidedAt: new Date(),
      });
      return { id: inserted.id, status: RoleRequestStatus.REVOKED };
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

class PendingRequestDecisionConflict extends Error {}
