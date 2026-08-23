import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import { RolesErrorCode } from '../roles/roles-error-code.enum';

/**
 * 전이표가 읽는 접근 권한 — 이 모듈의 판정은 전부 이 두 칸을 거친다.
 *
 * 표의 좌표는 여전히 legacy `Role`이다 — 그것은 변경 명령의 선후 상태를 싣는
 * **외부 계약**(`AdminAccessMutationCommand`의 `expectedRole`·`desiredRole`)이라 임의로
 * 바꿀 수 없다. 바뀌는 것은 그 좌표를 **무엇으로 읽느냐**다: 역할 enum을 직접
 * 비교하는 대신, 그 역할이 뜻하는 canonical 접근 권한으로 환산해 판정한다. 그래야
 * 인가 판정(`admin-access-authorization.ts`)·쓰기 파생(`admin-access-authority-write.ts`)과
 * 같은 어휘를 쓰고, 좌표가 canonical 칸로 옮겨갈 때 본문을 다시 쓰지 않는다.
 */
type AccessAuthority = {
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

function accessAuthorityOfRole(role: Role | null): AccessAuthority {
  switch (role) {
    case Role.ADMIN:
      return { hasStaffAccess: true, hasAdminAccess: true };
    case Role.STAFF:
      return { hasStaffAccess: true, hasAdminAccess: false };
    case Role.STUDENT:
    case null:
      return { hasStaffAccess: false, hasAdminAccess: false };
  }
}

/** 관리자 권한 없이 교직원 접근만 가진 상태 — 승인·회수가 다루는 바로 그 부여다. */
function isStaffOnlyAccess(role: Role | null): boolean {
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
  APPROVED: RoleRequestStatus.APPROVED,
  REJECTED: RoleRequestStatus.REJECTED,
  // 회수는 대기 중 요청을 결정하는 것이 아니라 **새 REVOKED 행을 남긴다**. 그래서
  // APPROVED·REJECTED와 달리 기존 행 id가 없고, 쓰기 방식도 CAS가 아니라 INSERT다
  // (`admin-access-mutation-policy.ts`의 요청 쓰기 계획이 그 차이를 담는다).
  REVOKED: RoleRequestStatus.REVOKED,
} as const;

export type AdminAccessPendingState =
  (typeof ADMIN_ACCESS_PENDING_STATES)[keyof typeof ADMIN_ACCESS_PENDING_STATES];
export type AdminAccessDecisionKind =
  (typeof ADMIN_ACCESS_DECISION_KINDS)[keyof typeof ADMIN_ACCESS_DECISION_KINDS];
export type AdminAccessRequestEffect =
  (typeof ADMIN_ACCESS_REQUEST_EFFECTS)[keyof typeof ADMIN_ACCESS_REQUEST_EFFECTS];

export type AdminAccessTableCurrentState = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly pendingState: AdminAccessPendingState;
};

export type AdminAccessTableDesiredState = {
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly decision: AdminAccessDecisionKind;
};

export type AdminAccessAllowedTransition = {
  readonly allowed: true;
  readonly status: 200;
  readonly code: null;
  readonly requestEffect: AdminAccessRequestEffect;
  readonly requiresCompleteProfile: boolean;
  readonly requiresSelfDeactivationGuard: boolean;
  readonly requiresLastActiveAdminGuard: boolean;
};

export type AdminAccessDeniedTransition = {
  readonly allowed: false;
  readonly status: 400 | 409;
  readonly code:
    | RolesErrorCode.ACCESS_CHANGE_REQUIRED
    | RolesErrorCode.ACCESS_TRANSITION_NOT_ALLOWED
    | RolesErrorCode.PENDING_REQUEST_DECISION_REQUIRED
    | RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION;
};

export type AdminAccessTransitionOutcome =
  AdminAccessAllowedTransition | AdminAccessDeniedTransition;

export type AdminAccessTransitionTableEntry = {
  readonly key: string;
  readonly current: AdminAccessTableCurrentState;
  readonly desired: AdminAccessTableDesiredState;
  readonly outcome: AdminAccessTransitionOutcome;
};

const ROLES = [null, Role.STUDENT, Role.STAFF, Role.ADMIN] as const;
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

/**
 * Exhaustive transition contract (4 roles × 2 account states × 2 pending
 * states) × (4 desired roles × 2 desired account states × 3 decisions).
 *
 * | Current pending | Decision | Desired-state precondition | Outcome |
 * | --- | --- | --- | --- |
 * | none | none | role/status changes | allow |
 * | none | APPROVE/REJECT | — | ROL_016 / 400 |
 * | PENDING | none | no state change | ROL_019 / 400 |
 * | PENDING | none | any state change | ROL_015 / 409 |
 * | PENDING | APPROVE | STAFF + ACTIVE | approve atomically |
 * | PENDING | APPROVE | otherwise | ROL_016 / 400 |
 * | PENDING | REJECT | no contradictory direct STAFF grant | reject atomically |
 * | PENDING | REJECT | direct STAFF grant | ROL_016 / 400 |
 *
 * A non-null role can transition back to null in exactly one case — revoking an
 * active STAFF grant, which clears `User.role` and appends a `REVOKED` request
 * row (#184). Every other non-null → null transition stays ROL_014 / 409, and so
 * does STAFF → null while a request is still PENDING: the request must be decided
 * first, otherwise the account would end up role-less **without** a REVOKED row
 * and the login seed guard (`auth.repository.ts`) would grant the role back.
 * Contextual self-deactivation and last-active-ADMIN guards are flags on allowed
 * entries.
 */
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

export class MissingAdminAccessTransitionError extends Error {
  constructor(key: string) {
    super(`Missing ADMIN access transition table entry: ${key}`);
    this.name = 'MissingAdminAccessTransitionError';
  }
}

export function resolveAdminAccessTransition(
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
    return desired.decision === ADMIN_ACCESS_DECISION_KINDS.NONE
      ? changesAccessState
        ? allowed(current, desired, directRequestEffect(current, desired))
        : denied(RolesErrorCode.ACCESS_CHANGE_REQUIRED, 400)
      : denied(RolesErrorCode.INVALID_ACCESS_REQUEST_DECISION, 400);
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

/**
 * 회수할 수 있는 현재 상태인가 — 확정된 STAFF이고 대기 중 요청이 없을 때만이다.
 *
 * PENDING을 함께 요구하는 이유는 결과물의 모양 때문이다. 회수는 `User.role`을 비우고
 * `REVOKED` 행을 남기는 한 쌍인데, 대기 중 요청이 있으면 그 요청의 결정(APPROVED·
 * REJECTED)이 같은 트랜잭션의 요청 쓰기 자리를 이미 차지한다. 그대로 통과시키면 역할만
 * 비고 `REVOKED` 행은 없는 계정이 생기고, 그런 계정은 로그인 시드 가드(`auth.repository.ts`의
 * `roleRequests: { none: { status: REVOKED } }`)가 회수로 알아보지 못해 다음 로그인에
 * 권한이 되살아난다. 그래서 대기 중 요청은 먼저 결정하게 하고 회수는 그다음이다.
 */
function isRevocable(current: AdminAccessTableCurrentState): boolean {
  return (
    isStaffOnlyAccess(current.role) &&
    current.pendingState === ADMIN_ACCESS_PENDING_STATES.NONE
  );
}

/**
 * 대기 중 요청 없이 접근 상태를 직접 바꾸는 전이가 요청 이력에 남기는 것.
 *
 * STAFF를 회수하는 전이만 `REVOKED` 행을 새로 남기고 나머지 직접 변경은 이력을 건드리지
 * 않는다. 회수 이력은 화면 안내(#184)와 로그인 시드 가드가 모두 읽는 사실이라, 회수라는
 * 사실이 `User.role`이 비었다는 것만으로 표현되면 신규 가입자와 구분되지 않는다.
 */
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
