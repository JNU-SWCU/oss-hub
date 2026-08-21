import { ApiError } from '@/lib/api-client';

import type {
  AdminAccessAccountStatus,
  AdminAccessConflictProjection,
  AdminAccessDetail,
  AdminAccessPatchRequest,
  AdminAccessRole,
} from './admin-access-api';

/**
 * Frontend policy for the `/admin/access` write surface. 이전에는 GRANT/REVOKE
 * Authority changes use Task 8's independent staff/admin commands. The legacy
 * CAS resource remains only for request decisions and account status. Every
 * write is still validated by the backend.
 */

export const ADMIN_ACCESS_MUTATION_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  GRANT_STAFF_ACCESS: 'GRANT_STAFF_ACCESS',
  REVOKE_STAFF_ACCESS: 'REVOKE_STAFF_ACCESS',
  GRANT_ADMIN_ACCESS: 'GRANT_ADMIN_ACCESS',
  REVOKE_ADMIN_ACCESS: 'REVOKE_ADMIN_ACCESS',
  SET_STATUS_ACTIVE: 'SET_STATUS_ACTIVE',
  SET_STATUS_DEACTIVATED: 'SET_STATUS_DEACTIVATED',
} as const;

export type AdminAccessMutationAction =
  (typeof ADMIN_ACCESS_MUTATION_ACTIONS)[keyof typeof ADMIN_ACCESS_MUTATION_ACTIONS];

export type IndependentAuthorityMutationAction =
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_STAFF_ACCESS
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_STAFF_ACCESS
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_ADMIN_ACCESS
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_ADMIN_ACCESS;

export type AdminAccessLegacyMutationAction = Exclude<
  AdminAccessMutationAction,
  IndependentAuthorityMutationAction
>;

export type AdminAccessSetStatusAction =
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_ACTIVE
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_DEACTIVATED;

export const ROLE_LABEL: Record<AdminAccessRole, string> = {
  STUDENT: '학생',
  STAFF: '교직원',
  ADMIN: '관리자',
};

export const ACCOUNT_STATUS_LABEL: Record<AdminAccessAccountStatus, string> = {
  ACTIVE: '활성',
  DEACTIVATED: '비활성',
};

export function isIndependentAuthorityMutationAction(
  action: AdminAccessMutationAction,
): action is IndependentAuthorityMutationAction {
  return (
    action === 'GRANT_STAFF_ACCESS' ||
    action === 'REVOKE_STAFF_ACCESS' ||
    action === 'GRANT_ADMIN_ACCESS' ||
    action === 'REVOKE_ADMIN_ACCESS'
  );
}

export function actionForAccountStatus(
  status: AdminAccessAccountStatus,
): AdminAccessSetStatusAction {
  return status === 'ACTIVE'
    ? ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_ACTIVE
    : ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_DEACTIVATED;
}

export interface AdminAccessMutationExtra {
  readonly reason?: string;
}

/**
 * Builds the legacy CAS PATCH body for request decisions and account status.
 * Independent authority actions never pass through this resource.
 */
export function buildAdminAccessPatchRequest(
  action: AdminAccessLegacyMutationAction,
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
    case 'SET_STATUS_ACTIVE':
      return {
        ...base,
        desiredRole: detail.role,
        desiredAccountStatus: 'ACTIVE',
      };
    case 'SET_STATUS_DEACTIVATED':
      return {
        ...base,
        desiredRole: detail.role,
        desiredAccountStatus: 'DEACTIVATED',
      };
    default:
      return assertNever(action);
  }
}

/**
 * Replaces the stale local projection with the authoritative one the
 * backend returned alongside a `ROL_013` conflict. Only the CAS-relevant
 * fields (`role`/`accountStatus`/`pendingRequest`) come from the
 * conflict projection — profile/history/etc. are untouched, since the
 * conflict response does not carry them.
 */
export function applyAdminAccessConflictProjection<T extends AdminAccessDetail>(
  detail: T,
  projection: AdminAccessConflictProjection,
): T {
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
 * every `RolesErrorCode`, including the two block codes above, and the
 * last-active-admin guard), falling back to a generic message only for
 * non-`ApiError` failures (network errors, aborted requests, etc.).
 */
export function adminAccessMutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

const ACTION_SUCCESS_LABEL: Record<AdminAccessMutationAction, string> = {
  APPROVE: '요청 승인',
  REJECT: '요청 반려',
  GRANT_STAFF_ACCESS: '교직원 접근 허용',
  REVOKE_STAFF_ACCESS: '교직원 접근 회수',
  GRANT_ADMIN_ACCESS: '관리자 접근 허용',
  REVOKE_ADMIN_ACCESS: '관리자 접근 회수',
  SET_STATUS_ACTIVE: '계정 재활성화',
  SET_STATUS_DEACTIVATED: '계정 비활성화',
};

export function adminAccessMutationSuccessMessage(
  action: AdminAccessMutationAction,
  githubLogin: string,
): string {
  return `${githubLogin}님에 대한 ${ACTION_SUCCESS_LABEL[action]} 처리를 완료했습니다.`;
}

function assertNever(value: never): never {
  throw new TypeError(
    `Unsupported admin access mutation action: ${String(value)}`,
  );
}
