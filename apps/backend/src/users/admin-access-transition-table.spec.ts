import { AccountStatus, Role } from '@prisma/client';
import {
  ROLES_ERROR_CODES,
  RolesErrorCode,
} from '../roles/roles-error-code.enum';
import {
  ADMIN_ACCESS_DECISION_KINDS,
  ADMIN_ACCESS_PENDING_STATES,
  resolveAdminAccessTransition,
  type AdminAccessRequestEffect,
  type AdminAccessTableCurrentState,
  type AdminAccessTableDesiredState,
  type AdminAccessTransitionOutcome,
} from './admin-access-transition-table';
import { ADMIN_ACCESS_TRANSITION_TABLE } from './admin-access-transition-table';
import { ADMIN_ACCESS_TRANSITION_FIXTURES } from './admin-access-transition-fixtures';

type OracleCase = {
  readonly name: string;
  readonly current: AdminAccessTableCurrentState;
  readonly desired: AdminAccessTableDesiredState;
  readonly expected: AdminAccessTransitionOutcome;
};

const ORACLE_ROLES = [null, Role.STUDENT, Role.STAFF, Role.ADMIN] as const;
const ORACLE_ACCOUNT_STATUSES = [
  AccountStatus.ACTIVE,
  AccountStatus.DEACTIVATED,
] as const;
const ORACLE_PENDING_STATES = [
  ADMIN_ACCESS_PENDING_STATES.NONE,
  ADMIN_ACCESS_PENDING_STATES.PENDING,
] as const;
const ORACLE_DECISIONS = [
  ADMIN_ACCESS_DECISION_KINDS.NONE,
  ADMIN_ACCESS_DECISION_KINDS.APPROVE,
  ADMIN_ACCESS_DECISION_KINDS.REJECT,
] as const;

const ORACLE_CURRENT_STATES = ORACLE_ROLES.flatMap((role) =>
  ORACLE_ACCOUNT_STATUSES.flatMap((accountStatus) =>
    ORACLE_PENDING_STATES.map((pendingState) => ({
      role,
      accountStatus,
      pendingState,
    })),
  ),
);

const ORACLE_DESIRED_STATES = ORACLE_ROLES.flatMap((role) =>
  ORACLE_ACCOUNT_STATUSES.flatMap((accountStatus) =>
    ORACLE_DECISIONS.map((decision) => ({ role, accountStatus, decision })),
  ),
);

const ADMIN_ACCESS_TRANSITION_ORACLE: readonly OracleCase[] =
  ORACLE_CURRENT_STATES.flatMap((current) =>
    ORACLE_DESIRED_STATES.map((desired) => ({
      name: `${current.role ?? 'UNASSIGNED'} ${current.accountStatus} ${current.pendingState} -> ${desired.role ?? 'UNASSIGNED'} ${desired.accountStatus} ${desired.decision}`,
      current,
      desired,
      expected: expectedTransitionOutcome(current, desired),
    })),
  );

/**
 * 프로덕션 로직을 독립 재구현한 오라클이다. **기대값은 프로덕션 상수를 쓰지 않고 문자열
 * 리터럴로 적는다** — `ADMIN_ACCESS_REQUEST_EFFECTS.REVOKED`를 그대로 재사용하면 상수의
 * 값 자체가 잘못 바뀌어도(예: `REVOKED: RoleRequestStatus.REJECTED`) 양쪽이 함께 움직여
 * 이 테스트가 초록으로 남는다. 이중 구현을 두는 이유가 바로 그 변이를 잡는 것이다.
 * 입력(역할·계정 상태·대기 상태·결정)은 `resolveAdminAccessTransition`의 인자 타입이라
 * 상수를 그대로 쓴다 — 그쪽은 기대값이 아니라 호출 규약이다.
 */
function expectedTransitionOutcome(
  current: AdminAccessTableCurrentState,
  desired: AdminAccessTableDesiredState,
): AdminAccessTransitionOutcome {
  // 회수(#184)만 확정된 역할을 다시 비운다. 오라클도 같은 규칙을 독립적으로 적는다 —
  // 확정된 STAFF이고 대기 중 요청이 없을 때만 통과하고, 그 전이는 REVOKED 행을 남긴다.
  const revokesStaff =
    current.role === Role.STAFF &&
    current.pendingState === ADMIN_ACCESS_PENDING_STATES.NONE &&
    desired.role === null;
  if (current.role !== null && desired.role === null && !revokesStaff) {
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
    return changesAccessState
      ? allowed(current, desired, revokesStaff ? 'REVOKED' : 'UNCHANGED')
      : denied(RolesErrorCode.ACCESS_CHANGE_REQUIRED, 400);
  }

  switch (desired.decision) {
    case ADMIN_ACCESS_DECISION_KINDS.NONE:
      return changesAccessState
        ? denied(RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED, 409)
        : denied(RolesErrorCode.ACCESS_CHANGE_REQUIRED, 400);
    case ADMIN_ACCESS_DECISION_KINDS.APPROVE:
      return desired.role === Role.STAFF &&
        desired.accountStatus === AccountStatus.ACTIVE
        ? allowed(current, desired, 'APPROVED')
        : denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400);
    case ADMIN_ACCESS_DECISION_KINDS.REJECT:
      return current.role !== Role.STAFF && desired.role === Role.STAFF
        ? denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400)
        : allowed(current, desired, 'REJECTED');
    default: {
      const unsupportedDecision: never = desired.decision;
      throw new Error(
        `Unsupported decision in test oracle: ${String(unsupportedDecision)}`,
      );
    }
  }
}

function allowed(
  current: AdminAccessTableCurrentState,
  desired: AdminAccessTableDesiredState,
  requestEffect: AdminAccessRequestEffect,
): AdminAccessTransitionOutcome {
  return {
    allowed: true,
    status: 200,
    code: null,
    requestEffect,
    requiresCompleteProfile: requestEffect === 'APPROVED',
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
  code:
    | RolesErrorCode.ACCESS_CHANGE_REQUIRED
    | RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED
    | RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED
    | RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION,
  status: 400 | 409,
): AdminAccessTransitionOutcome {
  return { allowed: false, status, code };
}

describe('ADMIN access transition table', () => {
  it('materializes every cross-product entry exactly once', () => {
    // Given
    const keys = ADMIN_ACCESS_TRANSITION_TABLE.map((entry) => entry.key);

    // When
    const uniqueKeys = new Set(keys);

    // Then
    expect(keys).toHaveLength(384);
    expect(uniqueKeys.size).toBe(384);
  });

  it.each(ADMIN_ACCESS_TRANSITION_ORACLE)(
    'independently verifies the complete oracle: $name',
    ({ current, desired, expected }) => {
      // When
      const resolved = resolveAdminAccessTransition(current, desired);

      // Then
      expect(resolved.outcome.allowed).toBe(expected.allowed);
      expect(resolved.outcome.status).toBe(expected.status);
      expect(resolved.outcome.code).toBe(expected.code);
      expect(resolved.outcome).toEqual(expected);

      if (expected.allowed && resolved.outcome.allowed) {
        expect(resolved.outcome.requestEffect).toBe(expected.requestEffect);
        expect(resolved.outcome.requiresCompleteProfile).toBe(
          expected.requiresCompleteProfile,
        );
        expect(resolved.outcome.requiresSelfDeactivationGuard).toBe(
          expected.requiresSelfDeactivationGuard,
        );
        expect(resolved.outcome.requiresLastActiveAdminGuard).toBe(
          expected.requiresLastActiveAdminGuard,
        );
      } else if (!expected.allowed && !resolved.outcome.allowed) {
        expect(ROLES_ERROR_CODES[resolved.outcome.code].status).toBe(
          resolved.outcome.status,
        );
        expect(ROLES_ERROR_CODES[expected.code].status).toBe(expected.status);
      }
    },
  );

  it.each(ADMIN_ACCESS_TRANSITION_FIXTURES)(
    '$name',
    ({ current, desired, expected }) => {
      // When
      const resolved = resolveAdminAccessTransition(current, desired);

      // Then
      expect(resolved.outcome).toEqual(expected);
    },
  );
});
