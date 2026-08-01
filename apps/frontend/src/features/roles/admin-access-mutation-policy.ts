import { ApiError } from '@/lib/api-client';

import type {
  AdminAccessAccountStatus,
  AdminAccessConflictProjection,
  AdminAccessDetail,
  AdminAccessPatchRequest,
  AdminAccessRole,
} from './admin-access-api';

/**
 * Frontend state machine for the six `/admin/access` write actions (PR04G).
 * Mirrors the *shape* of `apps/backend/src/users/admin-access-transition-table.ts`
 * and `admin-access-mutation-policy.ts` closely enough to decide which
 * actions to offer and how to build a CAS body, but does not duplicate the
 * backend's exhaustive matrix — the backend remains the sole source of
 * truth (every write is still validated server-side; this only avoids
 * showing buttons for transitions the backend is guaranteed to reject).
 *
 * Role tiers used by GRANT/REVOKE: `UNASSIGNED`/`STUDENT` (0) < `STAFF` (1)
 * < `ADMIN` (2). Both actions move exactly one tier — this needs no
 * additional client-side target-role picker and stays inside what the
 * transition table allows (role-only change, account status unchanged,
 * never back to `null`).
 */

export const ADMIN_ACCESS_MUTATION_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  GRANT: 'GRANT',
  REVOKE: 'REVOKE',
  DEACTIVATE: 'DEACTIVATE',
  REACTIVATE: 'REACTIVATE',
} as const;

export type AdminAccessMutationAction =
  (typeof ADMIN_ACCESS_MUTATION_ACTIONS)[keyof typeof ADMIN_ACCESS_MUTATION_ACTIONS];

export const ADMIN_ACCESS_MUTATION_ACTION_LABEL: Record<
  AdminAccessMutationAction,
  string
> = {
  APPROVE: '요청 승인',
  REJECT: '요청 반려',
  GRANT: '권한 직접 부여',
  REVOKE: '권한 회수',
  DEACTIVATE: '계정 비활성화',
  REACTIVATE: '계정 재활성화',
};

type MutationAvailabilityInput = Pick<
  AdminAccessDetail,
  'role' | 'accountStatus' | 'pendingRequest'
>;

const ROLE_RANK: Record<AdminAccessRole, number> = {
  STUDENT: 0,
  STAFF: 1,
  ADMIN: 2,
};
const GRANT_TARGET_BY_RANK: Record<number, AdminAccessRole> = {
  1: 'STAFF',
  2: 'ADMIN',
};
const REVOKE_TARGET_BY_RANK: Record<number, AdminAccessRole> = {
  0: 'STUDENT',
  1: 'STAFF',
};

function rankOf(role: AdminAccessRole | null): number {
  return role === null ? 0 : ROLE_RANK[role];
}

/** One tier above `role`, or `null` if already at the top (`ADMIN`). */
export function adminAccessGrantTargetRole(
  role: AdminAccessRole | null,
): AdminAccessRole | null {
  return GRANT_TARGET_BY_RANK[rankOf(role) + 1] ?? null;
}

/** One tier below `role`, or `null` if already at the floor (`STUDENT`/미지정). */
export function adminAccessRevokeTargetRole(
  role: AdminAccessRole | null,
): AdminAccessRole | null {
  return REVOKE_TARGET_BY_RANK[rankOf(role) - 1] ?? null;
}

/**
 * Whether `action` should be offered for the currently loaded projection.
 * Grounded directly in `ADMIN_ACCESS_TRANSITION_TABLE`'s constraints: a
 * pending request blocks any decision-less role/status change (`ROL_015`),
 * and role can never fall back to `null` (`ROL_014`). Actor-relative guards
 * (self-deactivation, last-active-admin) are NOT modeled here — the
 * frontend has no way to know the live active-admin count, and
 * self-deactivation is not a state-machine fact, so both surface only via
 * the real backend error after a confirmed attempt.
 */
export function isAdminAccessMutationAvailable(
  action: AdminAccessMutationAction,
  detail: MutationAvailabilityInput,
): boolean {
  switch (action) {
    case 'APPROVE':
    case 'REJECT':
      return detail.pendingRequest !== null;
    case 'GRANT':
      return (
        detail.pendingRequest === null &&
        adminAccessGrantTargetRole(detail.role) !== null
      );
    case 'REVOKE':
      return (
        detail.pendingRequest === null &&
        adminAccessRevokeTargetRole(detail.role) !== null
      );
    case 'DEACTIVATE':
      return (
        detail.pendingRequest === null && detail.accountStatus === 'ACTIVE'
      );
    case 'REACTIVATE':
      return (
        detail.pendingRequest === null && detail.accountStatus === 'DEACTIVATED'
      );
    default:
      return assertNever(action);
  }
}

export interface AdminAccessMutationExtra {
  readonly reason?: string;
}

/**
 * Builds the CAS PATCH body for `action` from the projection currently on
 * screen (`detail`) — never from a cached/stale copy. `expected*` fields
 * pin the caller's last-known state; the backend rejects with `ROL_013`
 * (`ACCESS_STATE_MISMATCH`) and returns the authoritative projection if
 * they no longer match.
 */
export function buildAdminAccessPatchRequest(
  action: AdminAccessMutationAction,
  detail: AdminAccessDetail,
  extra: AdminAccessMutationExtra = {},
): AdminAccessPatchRequest {
  const expectedPendingRequest = detail.pendingRequest
    ? { id: detail.pendingRequest.id, status: 'PENDING' as const }
    : null;
  const base = {
    expectedRole: detail.role,
    expectedAccountStatus: detail.accountStatus,
    expectedPendingRequest,
  };

  switch (action) {
    case 'APPROVE':
      return {
        ...base,
        desiredRole: 'STAFF',
        desiredAccountStatus: 'ACTIVE',
        requestDecision: { decision: 'APPROVE' },
      };
    case 'REJECT':
      return {
        ...base,
        desiredRole: detail.role,
        desiredAccountStatus: detail.accountStatus,
        requestDecision: { decision: 'REJECT', reason: extra.reason ?? '' },
      };
    case 'GRANT':
      return {
        ...base,
        desiredRole: requireTargetRole(adminAccessGrantTargetRole(detail.role)),
        desiredAccountStatus: detail.accountStatus,
      };
    case 'REVOKE':
      return {
        ...base,
        desiredRole: requireTargetRole(
          adminAccessRevokeTargetRole(detail.role),
        ),
        desiredAccountStatus: detail.accountStatus,
      };
    case 'DEACTIVATE':
      return {
        ...base,
        desiredRole: detail.role,
        desiredAccountStatus: 'DEACTIVATED' as AdminAccessAccountStatus,
      };
    case 'REACTIVATE':
      return {
        ...base,
        desiredRole: detail.role,
        desiredAccountStatus: 'ACTIVE' as AdminAccessAccountStatus,
      };
    default:
      return assertNever(action);
  }
}

function requireTargetRole(role: AdminAccessRole | null): AdminAccessRole {
  if (role === null) {
    throw new Error(
      '이 작업은 현재 상태에서 사용할 수 없습니다 (대상 역할 없음).',
    );
  }
  return role;
}

/**
 * Replaces the stale local projection with the authoritative one the
 * backend returned alongside a `ROL_013` conflict. Only the CAS-relevant
 * fields (`role`/`accountStatus`/`pendingRequest`) come from the
 * conflict projection — profile/history/etc. are untouched, since the
 * conflict response does not carry them.
 */
export function applyAdminAccessConflictProjection(
  detail: AdminAccessDetail,
  projection: AdminAccessConflictProjection,
): AdminAccessDetail {
  return {
    ...detail,
    role: projection.role,
    accountStatus: projection.accountStatus,
    pendingRequest: projection.pendingRequest,
  };
}

/** `RolesErrorCode.SELF_DEACTIVATION_FORBIDDEN` / `LAST_ACTIVE_ADMIN_REQUIRED`. */
const SELF_DEACTIVATION_FORBIDDEN_CODE = 'ROL_017';
const LAST_ACTIVE_ADMIN_REQUIRED_CODE = 'ROL_018';

export type AdminAccessMutationBlockKind =
  'SELF_DEACTIVATION' | 'LAST_ACTIVE_ADMIN' | null;

/**
 * Classifies a failed mutation as one of the two actor-relative guard
 * blocks, or `null` for anything else (including stale-CAS conflicts,
 * which callers should check separately via
 * `parseAdminAccessConflictProjection`).
 */
export function classifyAdminAccessMutationBlock(
  error: unknown,
): AdminAccessMutationBlockKind {
  if (!(error instanceof ApiError)) return null;
  switch (error.problem.code) {
    case SELF_DEACTIVATION_FORBIDDEN_CODE:
      return 'SELF_DEACTIVATION';
    case LAST_ACTIVE_ADMIN_REQUIRED_CODE:
      return 'LAST_ACTIVE_ADMIN';
    default:
      return null;
  }
}

/**
 * User-facing message for any failed mutation — sourced from the real
 * backend `ProblemDetail.detail` (already the correct Korean copy for
 * every `RolesErrorCode`, including the two block codes above), falling
 * back to a generic message only for non-`ApiError` failures (network
 * errors, aborted requests, etc.).
 */
export function adminAccessMutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function adminAccessMutationSuccessMessage(
  action: AdminAccessMutationAction,
  githubLogin: string,
): string {
  return `${githubLogin}님에 대한 ${ADMIN_ACCESS_MUTATION_ACTION_LABEL[action]} 처리를 완료했습니다.`;
}

function assertNever(value: never): never {
  throw new TypeError(
    `Unsupported admin access mutation action: ${String(value)}`,
  );
}
