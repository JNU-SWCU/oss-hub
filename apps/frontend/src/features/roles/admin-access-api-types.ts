export type AdminAccessRole = 'STUDENT' | 'STAFF' | 'ADMIN';
export type AdminAccessRoleFilter = 'UNASSIGNED' | AdminAccessRole;
export type AdminAccessAccountStatus = 'ACTIVE' | 'DEACTIVATED';
export type AdminAccessPendingFilter = 'NONE' | 'PENDING';
export type AdminAccessSortField =
  'name' | 'createdAt' | 'lastLoginAt' | 'role' | 'accountStatus';
export type AdminAccessSortDirection = 'asc' | 'desc';
export type AdminAccessStaffAccessRequestStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
export type AdminAccessLoginEvent = 'LOGIN' | 'LOGOUT';

export interface AdminAccessPendingRequest {
  readonly id: string;
  readonly status: 'PENDING';
  readonly createdAt: string;
}

export interface AdminAccessListItem {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AdminAccessRole | null;
  readonly accountStatus: AdminAccessAccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
  readonly createdAt: string;
  readonly pendingRequest: AdminAccessPendingRequest | null;
  readonly lastLoginAt: string | null;
}

export interface AdminAccessFacetCounts {
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
}

export interface AdminAccessListPage {
  readonly items: readonly AdminAccessListItem[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacetCounts;
}

export interface AdminAccessProfile {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
}

export interface AdminAccessDetail extends AdminAccessListItem {
  readonly profile: AdminAccessProfile;
}

export interface AdminAccessStaffAccessRequestHistoryItem {
  readonly id: string;
  readonly status: AdminAccessStaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly createdAt: string;
}

export interface AdminAccessLoginHistoryItem {
  readonly id: string;
  readonly event: AdminAccessLoginEvent;
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: string;
}

export interface AdminAccessHistory {
  readonly staffAccessRequests: {
    readonly items: readonly AdminAccessStaffAccessRequestHistoryItem[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
  readonly loginHistory: {
    readonly items: readonly AdminAccessLoginHistoryItem[];
    readonly page: number;
    readonly limit: number;
    readonly total: number;
  };
}

export interface AdminAccessListParams {
  readonly query?: string;
  readonly role?: AdminAccessRoleFilter;
  readonly accountStatus?: AdminAccessAccountStatus;
  readonly pendingRequest?: AdminAccessPendingFilter;
  readonly sort?: AdminAccessSortField;
  readonly direction?: AdminAccessSortDirection;
  readonly page?: number;
  readonly limit?: number;
}

export interface AdminAccessHistoryParams {
  readonly staffAccessRequestPage?: number;
  readonly staffAccessRequestLimit?: number;
  readonly loginPage?: number;
  readonly loginLimit?: number;
}

export interface AdminAccessExpectedPendingRequest {
  readonly id: string;
  readonly status: 'PENDING';
}

export type AdminAccessRequestDecisionInput =
  | { readonly decision: 'APPROVE' }
  | { readonly decision: 'REJECT'; readonly reason: string };

/** CAS mutation body: `expected*` fields are the caller's last-known projection. */
export interface AdminAccessPatchRequest {
  readonly expectedRole: AdminAccessRole | null;
  readonly desiredRole: AdminAccessRole | null;
  readonly expectedAccountStatus: AdminAccessAccountStatus;
  readonly desiredAccountStatus: AdminAccessAccountStatus;
  readonly expectedPendingRequest: AdminAccessExpectedPendingRequest | null;
  readonly requestDecision?: AdminAccessRequestDecisionInput;
}

export interface AdminAccessDecidedRequest {
  readonly id: string;
  readonly status: 'APPROVED' | 'REJECTED' | 'REVOKED';
}

export interface AdminAccessMutationResponse {
  readonly id: string;
  readonly role: AdminAccessRole | null;
  readonly accountStatus: AdminAccessAccountStatus;
  readonly pendingRequest: AdminAccessPendingRequest | null;
  readonly decidedRequest: AdminAccessDecidedRequest | null;
}

/** The backend's authoritative current-state projection returned on a 409 CAS conflict. */
export interface AdminAccessConflictProjection {
  readonly id: string;
  readonly role: AdminAccessRole | null;
  readonly accountStatus: AdminAccessAccountStatus;
  readonly pendingRequest: AdminAccessPendingRequest | null;
}

export interface AdminProfileUpdateCommand {
  readonly name?: string;
  readonly studentId?: string;
  readonly department?: string;
}

export interface AdminProfileUpdateResponse {
  readonly id: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
}
