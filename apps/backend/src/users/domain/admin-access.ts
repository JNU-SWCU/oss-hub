import {
  AccountStatus,
  LoginHistoryEvent,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuthorityLabel } from '../../common/authority-label';

export const ADMIN_ACCESS_REQUEST_DECISIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;

export const ADMIN_ACCESS_ROLE_FILTERS = {
  UNASSIGNED: 'UNASSIGNED',
  STUDENT: 'STUDENT',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export const ADMIN_ACCESS_PENDING_FILTERS = {
  NONE: 'NONE',
  PENDING: StaffAccessRequestStatus.PENDING,
} as const;

export const ADMIN_ACCESS_SORT_FIELDS = {
  NAME: 'name',
  CREATED_AT: 'createdAt',
  LAST_LOGIN_AT: 'lastLoginAt',
  ROLE: 'role',
  ACCOUNT_STATUS: 'accountStatus',
} as const;

export const ADMIN_ACCESS_SORT_DIRECTIONS = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

export const ADMIN_ACCESS_DEFAULT_SORT = ADMIN_ACCESS_SORT_FIELDS.NAME;
export const ADMIN_ACCESS_DEFAULT_DIRECTION = ADMIN_ACCESS_SORT_DIRECTIONS.ASC;

export type AdminAccessRequestDecision =
  | {
      readonly decision: typeof ADMIN_ACCESS_REQUEST_DECISIONS.APPROVE;
    }
  | {
      readonly decision: typeof ADMIN_ACCESS_REQUEST_DECISIONS.REJECT;
      readonly reason: string;
    };

export type AdminAccessExpectedPendingRequest = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
};

export type AdminAccessMutationCommand = {
  readonly expectedRole: AuthorityLabel | null;
  readonly desiredRole: AuthorityLabel | null;
  readonly expectedAccountStatus: AccountStatus;
  readonly desiredAccountStatus: AccountStatus;
  readonly expectedPendingRequest: AdminAccessExpectedPendingRequest | null;
  readonly requestDecision?: AdminAccessRequestDecision;
};

export type AdminAccessPendingRequest = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: Date;
};

export type AdminAccessCasProjection = {
  readonly id: string;
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly pendingRequest: AdminAccessPendingRequest | null;
};

/**
 * 이 변경이 요청 이력에 남긴 행. APPROVED·REJECTED는 대기 중이던 행을 결정한 결과이고,
 * REVOKED는 **새로 삽입한** 행이다(#184) — 회수는 기존 APPROVED 행을 덮어쓰지 않으므로
 * 여기 실리는 id는 방금 만들어진 행의 id다.
 */
export type AdminAccessDecidedRequest = {
  readonly id: string;
  readonly status:
    | typeof StaffAccessRequestStatus.APPROVED
    | typeof StaffAccessRequestStatus.REJECTED
    | typeof StaffAccessRequestStatus.REVOKED;
};

export type AdminAccessMutationResult = AdminAccessCasProjection & {
  readonly decidedRequest: AdminAccessDecidedRequest | null;
};

export type AdminAccessRoleFilter =
  (typeof ADMIN_ACCESS_ROLE_FILTERS)[keyof typeof ADMIN_ACCESS_ROLE_FILTERS];

export type AdminAccessPendingFilter =
  (typeof ADMIN_ACCESS_PENDING_FILTERS)[keyof typeof ADMIN_ACCESS_PENDING_FILTERS];

export type AdminAccessSortField =
  (typeof ADMIN_ACCESS_SORT_FIELDS)[keyof typeof ADMIN_ACCESS_SORT_FIELDS];

export type AdminAccessSortDirection =
  (typeof ADMIN_ACCESS_SORT_DIRECTIONS)[keyof typeof ADMIN_ACCESS_SORT_DIRECTIONS];

export type AdminAccessListQuery = {
  readonly query: string;
  readonly role?: AdminAccessRoleFilter;
  readonly accountStatus?: AccountStatus;
  readonly pendingRequest?: AdminAccessPendingFilter;
  readonly sort?: AdminAccessSortField;
  readonly direction?: AdminAccessSortDirection;
  readonly page: number;
  readonly limit: number;
};

export type AdminAccessProfile = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
};

export type AdminAccessUser = {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AuthorityLabel | null;
  readonly accountStatus: AccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
  readonly pendingRequest: AdminAccessPendingRequest | null;
  readonly lastLoginAt: Date | null;
};

export type AdminAccessFacets = {
  readonly roles: {
    readonly unassigned: number;
    readonly student: number;
    readonly staff: number;
    readonly admin: number;
  };
  readonly accountStatuses: {
    readonly active: number;
    readonly deactivated: number;
  };
  readonly pendingRequests: {
    readonly none: number;
    readonly pending: number;
  };
};

export type AdminAccessUserPage = {
  readonly items: readonly AdminAccessUser[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacets;
};

export type AdminAccessUserDetail = AdminAccessUser & {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly profile: AdminAccessProfile;
};

export type AdminAccessStaffAccessRequestHistoryItem = {
  readonly id: string;
  readonly status: StaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly createdAt: Date;
};

export type AdminAccessStaffAccessRequestHistoryPage = {
  readonly items: readonly AdminAccessStaffAccessRequestHistoryItem[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
};

export type AdminAccessLoginHistoryItem = {
  readonly id: string;
  readonly event: LoginHistoryEvent;
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: Date;
};

export type AdminAccessLoginHistoryPage = {
  readonly items: readonly AdminAccessLoginHistoryItem[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
};

export type AdminAccessHistoryQuery = {
  readonly staffAccessRequests: { readonly page: number; readonly limit: number };
  readonly loginHistory: { readonly page: number; readonly limit: number };
};

export type AdminAccessUserHistory = {
  readonly staffAccessRequests: AdminAccessStaffAccessRequestHistoryPage;
  readonly loginHistory: AdminAccessLoginHistoryPage;
};
