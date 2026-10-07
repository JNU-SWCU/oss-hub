import { ApiError } from '@/lib/api-client';

import type {
  AdminAccessAccountStatus,
  AdminAccessConflictProjection,
  AdminAccessDecidedRequest,
  AdminAccessDetail,
  AdminAccessHistory,
  AdminAccessPatchRequest,
} from './admin-access-api';
import type {
  CanonicalAdminAccessDetail,
  MemberKindMutationFields,
  MemberKindMutationRequest,
} from './independent-authority-api';

export const ADMIN_ACCESS_MUTATION_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  SET_MEMBER_STUDENT: 'SET_MEMBER_STUDENT',
  SET_MEMBER_STAFF: 'SET_MEMBER_STAFF',
  GRANT_ADMIN_ACCESS: 'GRANT_ADMIN_ACCESS',
  REVOKE_ADMIN_ACCESS: 'REVOKE_ADMIN_ACCESS',
  SET_STATUS_ACTIVE: 'SET_STATUS_ACTIVE',
  SET_STATUS_DEACTIVATED: 'SET_STATUS_DEACTIVATED',
} as const;

export type AdminAccessMutationAction =
  (typeof ADMIN_ACCESS_MUTATION_ACTIONS)[keyof typeof ADMIN_ACCESS_MUTATION_ACTIONS];

export type IndependentAuthorityMutationAction =
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.GRANT_ADMIN_ACCESS
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.REVOKE_ADMIN_ACCESS;

export type MemberKindMutationAction =
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STUDENT
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STAFF;

export type AdminAccessLegacyMutationAction = Exclude<
  AdminAccessMutationAction,
  IndependentAuthorityMutationAction | MemberKindMutationAction
>;

export type AdminAccessSetStatusAction =
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_ACTIVE
  | typeof ADMIN_ACCESS_MUTATION_ACTIONS.SET_STATUS_DEACTIVATED;

export function isIndependentAuthorityMutationAction(
  action: AdminAccessMutationAction,
): action is IndependentAuthorityMutationAction {
  return action === 'GRANT_ADMIN_ACCESS' || action === 'REVOKE_ADMIN_ACCESS';
}

export function isMemberKindMutationAction(
  action: AdminAccessMutationAction,
): action is MemberKindMutationAction {
  return action === 'SET_MEMBER_STUDENT' || action === 'SET_MEMBER_STAFF';
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

export function buildMemberKindMutationRequest(
  action: MemberKindMutationAction,
  detail: CanonicalAdminAccessDetail,
  fields: MemberKindMutationFields = {},
): MemberKindMutationRequest {
  if (!detail.memberKind) {
    throw new TypeError(
      'Member-kind mutation requires an existing canonical member kind.',
    );
  }
  return {
    memberKind:
      action === ADMIN_ACCESS_MUTATION_ACTIONS.SET_MEMBER_STUDENT
        ? 'STUDENT'
        : 'STAFF',
    expectedMemberKind: detail.memberKind,
    expectedHasStaffAccess: detail.hasStaffAccess,
    ...fields,
  };
}

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

export function applyAdminAccessDecidedRequestToHistory(
  history: AdminAccessHistory,
  decided: AdminAccessDecidedRequest | null,
): AdminAccessHistory {
  if (!decided) return history;
  const { items } = history.staffAccessRequests;
  if (!items.some((item) => item.id === decided.id)) return history;
  return {
    ...history,
    staffAccessRequests: {
      ...history.staffAccessRequests,
      items: items.map((item) =>
        item.id === decided.id ? { ...item, status: decided.status } : item,
      ),
    },
  };
}

const SELF_DEACTIVATION_FORBIDDEN_CODE = 'ROL_017';
const LAST_ACTIVE_ADMIN_REQUIRED_CODE = 'ROL_018';

export type AdminAccessMutationBlockKind =
  'SELF_DEACTIVATION' | 'LAST_ACTIVE_ADMIN' | null;

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

export function adminAccessMutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail;
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

const ACTION_SUCCESS_LABEL: Record<AdminAccessMutationAction, string> = {
  APPROVE: '요청 승인',
  REJECT: '요청 반려',
  SET_MEMBER_STUDENT: '학생 유형 적용',
  SET_MEMBER_STAFF: '교직원 유형 적용',
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
