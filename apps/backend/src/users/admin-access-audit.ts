import { StaffAccessRequestStatus } from '@prisma/client';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
  type AccessAuditAction,
  type AccessAuditMetadata,
} from '../audit-log/audit-log-metadata';
import {
  ADMIN_ACCESS_REQUEST_DECISIONS,
  type AdminAccessMutationCommand,
  type AdminAccessMutationResult,
} from './domain/admin-access';
import {
  ADMIN_ACCESS_REQUEST_EFFECTS,
  type AdminAccessRequestEffect,
} from './admin-access-transition-table';
import type {
  AdminAccessActor,
  AdminAccessUserRecord,
} from './admin-access.repository';

export type AdminAccessAudit = {
  readonly action: AccessAuditAction;
  readonly targetType: 'USER' | 'ROLE_REQUEST';
  readonly targetId: string;
  readonly metadata: AccessAuditMetadata;
};

export class InvalidAdminAccessAuditError extends Error {
  override readonly name = 'InvalidAdminAccessAuditError';

  constructor() {
    super('Allowed admin access transition cannot be represented as audit.');
  }
}

export function createAdminAccessAudit(input: {
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
    // 대상은 이 트랜잭션에서 잠근 이벤트 시점 레코드(input.before)에서 스냅샷한다 —
    // 조회 시점에 User를 다시 읽지 않는다(actor 스냅샷과 동일한 규약).
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
        metadata: createAccessAuditMetadata({
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
        metadata: createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
          rejectionReason: decision.reason,
        }),
      };
    }
    case ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED: {
      // 대상은 방금 삽입한 REVOKED 행이다 — 승인 행(`before.pendingRequest`는 회수 시
      // 언제나 null이다)을 가리키지 않는다. `before.requestStatus`도 null 그대로 둔다:
      // APPROVED를 억지로 채우면 신청 없이 직접 STAFF를 받은 사람에게는 거짓이 되고,
      // 애초에 APPROVED 행이 파괴되지 않는 것이 이 설계의 요지다.
      const decidedRequest = input.result.decidedRequest;
      if (decidedRequest?.status !== StaffAccessRequestStatus.REVOKED) {
        throw new InvalidAdminAccessAuditError();
      }
      return {
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REVOKED,
        targetType: 'ROLE_REQUEST',
        targetId: decidedRequest.id,
        metadata: createAccessAuditMetadata({
          ...common,
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REVOKED,
        }),
      };
    }
    case ADMIN_ACCESS_REQUEST_EFFECTS.UNCHANGED:
      return createDirectAccessAudit(input, common);
    default:
      return assertNever(input.requestEffect);
  }
}

function createDirectAccessAudit(
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
      metadata: createAccessAuditMetadata({
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
      metadata: createAccessAuditMetadata({
        ...common,
        eventKind: ACCESS_AUDIT_EVENT_KINDS.ACCOUNT_STATUS_CHANGED,
      }),
    };
  }
  throw new InvalidAdminAccessAuditError();
}

function assertNever(value: never): never {
  void value;
  throw new InvalidAdminAccessAuditError();
}
