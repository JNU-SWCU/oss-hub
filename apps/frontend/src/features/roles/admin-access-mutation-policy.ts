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
 * 두 액션이 `admin-access-transition-table.ts`의 사다리(한 단계씩만 이동)를
 * 흉내 냈지만, 백엔드는 사실 `null` 대상만 제외하면 임의의 역할 점프를
 * 허용한다(`apps/backend/src/users/admin-access-transition-table.ts`의
 * `classifyTransition` — role과 accountStatus를 동시에 바꾸는 요청만 막고,
 * 역할 단독 변경은 사다리 제약이 없다). 그래서 이 파일은 역할을 직접
 * 선택하는 세 액션(SET_ROLE_*)과 계정 상태를 직접 선택하는 두 액션
 * (SET_STATUS_*)으로 재구성한다. 모든 쓰기는 여전히 서버에서 검증된다 —
 * 이 파일은 버튼을 무엇으로 보여줄지만 결정한다.
 */

export const ADMIN_ACCESS_MUTATION_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  SET_ROLE_STUDENT: 'SET_ROLE_STUDENT',
  SET_ROLE_STAFF: 'SET_ROLE_STAFF',
  SET_ROLE_ADMIN: 'SET_ROLE_ADMIN',
  SET_STATUS_ACTIVE: 'SET_STATUS_ACTIVE',
  SET_STATUS_DEACTIVATED: 'SET_STATUS_DEACTIVATED',
} as const;

export type AdminAccessMutationAction =
  (typeof ADMIN_ACCESS_MUTATION_ACTIONS)[keyof typeof ADMIN_ACCESS_MUTATION_ACTIONS];

export type AdminAccessSetRoleAction =
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_ROLE_STUDENT
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_ROLE_STAFF
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_ROLE_ADMIN;

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

/** 역할 선택 컨트롤이 버튼을 그리는 순서 — 낮은 권한에서 높은 권한 순. */
export const ROLE_ORDER: readonly AdminAccessRole[] = [
  'STUDENT',
  'STAFF',
  'ADMIN',
];

const ROLE_RANK: Record<AdminAccessRole, number> = {
  STUDENT: 0,
  STAFF: 1,
  ADMIN: 2,
};

/** 미지정(`null`)은 `STUDENT`와 같은 순위로 취급한다 — 첫 역할 배정은 강등이 아니다. */
export function rankOfAdminAccessRole(role: AdminAccessRole | null): number {
  return role === null ? 0 : ROLE_RANK[role];
}

export function actionForRole(role: AdminAccessRole): AdminAccessSetRoleAction {
  switch (role) {
    case 'STUDENT':
      return ADMIN_ACCESS_MUTATION_ACTIONS.SET_ROLE_STUDENT;
    case 'STAFF':
      return ADMIN_ACCESS_MUTATION_ACTIONS.SET_ROLE_STAFF;
    case 'ADMIN':
      return ADMIN_ACCESS_MUTATION_ACTIONS.SET_ROLE_ADMIN;
    default:
      return assertNever(role);
  }
}

export function roleForAction(action: AdminAccessSetRoleAction): AdminAccessRole {
  switch (action) {
    case 'SET_ROLE_STUDENT':
      return 'STUDENT';
    case 'SET_ROLE_STAFF':
      return 'STAFF';
    case 'SET_ROLE_ADMIN':
      return 'ADMIN';
    default:
      return assertNever(action);
  }
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
 * Builds the CAS PATCH body for `action` from the projection currently on
 * screen (`detail`) — never from a cached/stale copy. `expected*` fields
 * pin the caller's last-known state; the backend rejects with `ROL_013`
 * (`ACCESS_STATE_MISMATCH`) and returns the authoritative projection if
 * they no longer match. 역할 변경 액션은 accountStatus를, 계정 상태 변경
 * 액션은 role을 현재 값 그대로 보내 — 백엔드가 둘의 동시 변경을 거부하므로
 * (`classifyTransition`) 한 번에 하나만 바뀐다.
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
    case 'SET_ROLE_STUDENT':
      return { ...base, desiredRole: 'STUDENT', desiredAccountStatus: detail.accountStatus };
    case 'SET_ROLE_STAFF':
      return { ...base, desiredRole: 'STAFF', desiredAccountStatus: detail.accountStatus };
    case 'SET_ROLE_ADMIN':
      return { ...base, desiredRole: 'ADMIN', desiredAccountStatus: detail.accountStatus };
    case 'SET_STATUS_ACTIVE':
      return { ...base, desiredRole: detail.role, desiredAccountStatus: 'ACTIVE' };
    case 'SET_STATUS_DEACTIVATED':
      return { ...base, desiredRole: detail.role, desiredAccountStatus: 'DEACTIVATED' };
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
  SET_ROLE_STUDENT: '학생으로 역할 변경',
  SET_ROLE_STAFF: '교직원으로 역할 변경',
  SET_ROLE_ADMIN: '관리자로 역할 변경',
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
