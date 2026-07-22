import type { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';

export const STAFF_ROLE_REQUEST_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REVOKE: 'REVOKE',
  REACTIVATE: 'REACTIVATE',
} as const;

export type StaffRoleRequestAction =
  | { readonly action: typeof STAFF_ROLE_REQUEST_ACTIONS.APPROVE }
  | {
      readonly action: typeof STAFF_ROLE_REQUEST_ACTIONS.REJECT;
      readonly reason: string;
    }
  | { readonly action: typeof STAFF_ROLE_REQUEST_ACTIONS.REVOKE }
  | { readonly action: typeof STAFF_ROLE_REQUEST_ACTIONS.REACTIVATE };

export interface StaffRoleRequestListQuery {
  readonly status: RoleRequestStatus;
  readonly query: string;
  readonly page: number;
  readonly limit: number;
}

export interface StaffRoleRequestRecord {
  readonly id: string;
  readonly userId: string;
  readonly githubLogin: string;
  readonly userRole: Role | null;
  readonly userAccountStatus: AccountStatus;
  readonly status: RoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly createdAt: Date;
}

export interface StaffRoleRequestTransition {
  readonly requestId: string;
  readonly actorId: string;
  readonly expectedStatus: RoleRequestStatus;
  readonly nextStatus: RoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date;
}

export interface StaffUserRoleTransition {
  readonly userId: string;
  readonly expectedRole: Role | null;
  readonly expectedAccountStatus: AccountStatus;
  readonly nextRole: Role | null;
}

export interface StaffUserAccountStatusTransition {
  readonly userId: string;
  readonly expectedRole: Role;
  readonly expectedAccountStatus: AccountStatus;
  readonly nextAccountStatus: AccountStatus;
}

export interface StaffRoleReactivationApproval {
  readonly userId: string;
  readonly actorId: string;
  readonly decidedAt: Date;
}
