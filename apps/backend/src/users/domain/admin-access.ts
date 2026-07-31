import {
  AccountStatus,
  LoginHistoryEvent,
  Role,
  RoleRequestStatus,
} from '@prisma/client';

export const ADMIN_ACCESS_REQUEST_DECISIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;

export const ADMIN_ACCESS_ROLE_FILTERS = {
  UNASSIGNED: 'UNASSIGNED',
  STUDENT: Role.STUDENT,
  STAFF: Role.STAFF,
  ADMIN: Role.ADMIN,
} as const;

export const ADMIN_ACCESS_PENDING_FILTERS = {
  NONE: 'NONE',
  PENDING: RoleRequestStatus.PENDING,
} as const;

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
  readonly status: typeof RoleRequestStatus.PENDING;
};

export type AdminAccessMutationCommand = {
  readonly expectedRole: Role | null;
  readonly desiredRole: Role | null;
  readonly expectedAccountStatus: AccountStatus;
  readonly desiredAccountStatus: AccountStatus;
  readonly expectedPendingRequest: AdminAccessExpectedPendingRequest | null;
  readonly requestDecision?: AdminAccessRequestDecision;
};

export type AdminAccessPendingRequest = {
  readonly id: string;
  readonly status: typeof RoleRequestStatus.PENDING;
  readonly createdAt: Date;
};

export type AdminAccessCasProjection = {
  readonly id: string;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly pendingRequest: AdminAccessPendingRequest | null;
};

export type AdminAccessDecidedRequest = {
  readonly id: string;
  readonly status:
    typeof RoleRequestStatus.APPROVED | typeof RoleRequestStatus.REJECTED;
};

export type AdminAccessMutationResult = AdminAccessCasProjection & {
  readonly decidedRequest: AdminAccessDecidedRequest | null;
};

export type AdminAccessRoleFilter =
  (typeof ADMIN_ACCESS_ROLE_FILTERS)[keyof typeof ADMIN_ACCESS_ROLE_FILTERS];

export type AdminAccessPendingFilter =
  (typeof ADMIN_ACCESS_PENDING_FILTERS)[keyof typeof ADMIN_ACCESS_PENDING_FILTERS];

export type AdminAccessListQuery = {
  readonly query: string;
  readonly role?: AdminAccessRoleFilter;
  readonly accountStatus?: AccountStatus;
  readonly pendingRequest?: AdminAccessPendingFilter;
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
  readonly role: Role | null;
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
  readonly profile: AdminAccessProfile;
};

export type AdminAccessRoleRequestHistoryItem = {
  readonly id: string;
  readonly status: RoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly createdAt: Date;
};

export type AdminAccessRoleRequestHistoryPage = {
  readonly items: readonly AdminAccessRoleRequestHistoryItem[];
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
  readonly roleRequests: { readonly page: number; readonly limit: number };
  readonly loginHistory: { readonly page: number; readonly limit: number };
};

export type AdminAccessUserHistory = {
  readonly roleRequests: AdminAccessRoleRequestHistoryPage;
  readonly loginHistory: AdminAccessLoginHistoryPage;
};
