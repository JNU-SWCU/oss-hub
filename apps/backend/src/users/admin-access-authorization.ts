import { AccountStatus } from '@prisma/client';
import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth/auth-error-code.enum';
import { DomainException } from '../common/error-code';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import type { AdminAccessActor } from './admin-access.repository';
import { isStaffOnlyAccess } from './admin-access-transition-table';
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
  assertDecisionOnlyCommand(decision, command);
}

/**
 * 결정 말고는 아무것도 바꾸지 않는 명령인지 확인한다.
 *
 * 결정이 실려 있다는 것만 보고 통과시키면, 같은 요청에 얹힌 역할·계정 상태 변경이
 * 함께 적용된다. 그 자리를 통해 교직원이 남의 계정에 관리자 접근을 부여할 수 있었다(#1082).
 *
 * 승인은 그 자체가 교직원 접근을 부여하는 동작이므로 `desiredRole`이 교직원 부여인 것까지는
 * 결정의 결과다. 그보다 넓은 권한이나 계정 상태 변경은 결정의 결과가 아니다.
 *
 * 어느 역할이 교직원 부여인지는 `admin-access-transition-table`의 `isStaffOnlyAccess`가
 * 원본이다. 여기서 역할 이름을 다시 나열하면 역할이 늘 때 이 검사만 조용히 뒤처진다 —
 * 전이표가 그 판정을 canonical 접근 권한으로 환산해 두었으므로 같은 어휘를 그대로 쓴다.
 */
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
