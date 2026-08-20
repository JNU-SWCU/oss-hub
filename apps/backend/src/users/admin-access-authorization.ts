import { AccountStatus, Role } from '@prisma/client';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import type { AdminAccessActor } from './admin-access.repository';
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
  if (actor.role !== Role.ADMIN) {
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
  if (actor.role !== Role.ADMIN && actor.role !== Role.STAFF) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
  return actor;
}

export function isAdminActor(actor: AdminAccessActor): boolean {
  return actor.role === Role.ADMIN;
}

/**
 * STAFF는 대기 요청의 승인·반려만 할 수 있다. 역할·상태·회수는 관리자 전용이다.
 * 자기 자신 PENDING은 현재 가입 흐름에서 나오지 않지만, actor === target이면
 * 거절한다 — 동료 가입을 승인하는 것이 의도이지 자기 결재가 아니다.
 */
export function assertAccessMutationAllowed(
  actor: AdminAccessActor,
  targetUserId: string,
  command: AdminAccessMutationCommand,
): void {
  if (actor.id === targetUserId) {
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
}
