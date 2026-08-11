import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';
import type {
  AdminAccessActor,
  AdminAccessUserRecord,
} from './admin-access.repository';
import {
  ADMIN_ACCESS_DECISION_KINDS,
  ADMIN_ACCESS_REQUEST_EFFECTS,
  type AdminAccessRequestEffect,
} from './admin-access-transition-table';
import {
  ADMIN_ACCESS_REQUEST_DECISIONS,
  type AdminAccessMutationCommand,
} from './domain/admin-access';

export function matchesExpectedAccessState(
  current: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
): boolean {
  if (
    current.role !== command.expectedRole ||
    current.accountStatus !== command.expectedAccountStatus
  ) {
    return false;
  }
  const expectedRequest = command.expectedPendingRequest;
  const currentRequest = current.pendingRequest;
  return expectedRequest === null
    ? currentRequest === null
    : currentRequest?.id === expectedRequest.id;
}

export function removesExpectedActiveAdmin(
  command: AdminAccessMutationCommand,
): boolean {
  return (
    command.expectedRole === Role.ADMIN &&
    command.expectedAccountStatus === AccountStatus.ACTIVE &&
    (command.desiredRole !== Role.ADMIN ||
      command.desiredAccountStatus !== AccountStatus.ACTIVE)
  );
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
      return assertNever(decision);
  }
}

/**
 * 자기 자신에게 ADMIN을 부여하는 전이인가 — 관리자 승격은 **다른 사람이** 해야 한다(#687).
 *
 * ⚠ **지금의 호출 순서에서는 이 조건이 성립하지 않는다.** `mutateAdminAccess`는
 * `lockActiveAdmins`로 활성 ADMIN 행을 잠근 **뒤** actor를 다시 읽어 ADMIN임을 확인하고,
 * 그다음 대상 행을 읽는다. actor와 대상이 같은 행이면 그 행은 이미 잠긴 채 ADMIN이므로
 * `before.role !== ADMIN`이 참이 될 수 없다. 즉 이 가드는 **현재 도달 불가능한
 * fail-closed 백스톱**이다 — 잠금·재조회 순서가 바뀌어 대상 행이 잠기지 않은 채 읽히는
 * 날, 자기 승격이 조용히 열리는 대신 여기서 막힌다.
 *
 * 그래서 이 함수의 시험은 서비스가 만들 수 없는 상태를 대역으로 꾸며 내지 않고
 * `enforceAdminAccessGuards`를 직접 불러 확인한다(`admin-access-mutation-policy.spec.ts`).
 * 서비스 수준에서 검사할 수 있는 것은 "남을 ADMIN으로 올리는 것은 막지 않는다" 쪽뿐이다.
 */
function grantsAdminToSelf(
  actor: AdminAccessActor,
  before: AdminAccessUserRecord,
  command: AdminAccessMutationCommand,
): boolean {
  return (
    actor.id === before.id &&
    command.desiredRole === Role.ADMIN &&
    before.role !== Role.ADMIN
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

/**
 * 이 변경이 `RoleRequest`에 해야 하는 쓰기. 결정과 회수는 **쓰기 방식이 다르다** —
 * 결정은 대기 중이던 행 하나를 노리는 CAS라 대상 id를 미리 알지만, 회수는 새 행을
 * 삽입하므로 id가 쓰기 이후에야 생긴다(#184). 그 차이를 타입으로 갈라 두어야 회수를
 * 결정 경로에 얹으려는 시도가 컴파일에서 막힌다.
 */
export type AdminAccessRequestWrite =
  | { readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.NONE }
  | {
      readonly kind: typeof ADMIN_ACCESS_REQUEST_WRITE_KINDS.DECIDE_PENDING;
      readonly requestId: string;
      readonly nextStatus:
        typeof RoleRequestStatus.APPROVED | typeof RoleRequestStatus.REJECTED;
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
      // 전이표가 회수를 대기 중 요청이 없을 때만 허용하므로 여기서 결정할 행은 없다.
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
      return assertNever(effect);
  }
}

export function roleError(code: RolesErrorCode): DomainException {
  return new DomainException(ROLES_ERROR_CODES[code]);
}

export function staleAccessError(
  current: AdminAccessUserRecord,
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
              status: RoleRequestStatus.PENDING,
              createdAt: current.pendingRequest.createdAt.toISOString(),
            }
          : null,
      },
    },
  );
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported admin access variant: ${String(value)}`);
}
