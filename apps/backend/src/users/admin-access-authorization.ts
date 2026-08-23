import { AccountStatus } from '@prisma/client';
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
  if (!actor.hasAdminAccess) {
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
  if (!actor.hasStaffAccess && !actor.hasAdminAccess) {
    throw new DomainException(ROLES_ERROR_CODES[RolesErrorCode.ADMIN_ONLY]);
  }
  return actor;
}

export function isAdminActor(actor: AdminAccessActor): boolean {
  return actor.hasAdminAccess;
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

/**
 * STAFF는 대기 요청의 승인·반려만 할 수 있다. 역할·상태·회수는 관리자 전용이다.
 * 자기 가입 신청 처리만 `ROL_020`이다. 자기 계정 비활성(`ROL_017`)과
 * 마지막 관리자 강등(`ROL_018`)은 기존 가드가 원본이다.
 */
export function assertAccessMutationAllowed(
  actor: AdminAccessActor,
  targetUserId: string,
  command: AdminAccessMutationCommand,
): void {
  if (actor.id === targetUserId && isRequestDecisionCommand(command)) {
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
