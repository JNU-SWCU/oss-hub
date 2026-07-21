export type RoleSelection = 'STUDENT' | 'STAFF';

export type RoleRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type StaffRoleRequestStatus = RoleRequestStatus | 'REVOKED';

export interface RoleSelectionResult {
  readonly selectedRole: RoleSelection;
  readonly role: 'STUDENT' | null;
  readonly requestStatus: 'PENDING' | null;
  readonly redirectTo: string;
}

export interface RoleRequest {
  readonly requestedRole: 'STAFF';
  readonly status: RoleRequestStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly rejectionReason: string | null;
}

export interface StaffRoleRequest {
  readonly id: string;
  readonly githubLogin: string;
  readonly requestedRole: 'STAFF';
  readonly status: StaffRoleRequestStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly rejectionReason: string | null;
}

export interface StaffRoleRequestPage {
  readonly items: readonly StaffRoleRequest[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
}

export interface StaffRoleRequestListParams {
  readonly status: StaffRoleRequestStatus;
  readonly query: string;
  readonly page: number;
  readonly limit: number;
}

export type StaffRoleRequestDecision =
  | { readonly action: 'APPROVE' }
  | { readonly action: 'REJECT'; readonly reason: string }
  | { readonly action: 'REVOKE' };
