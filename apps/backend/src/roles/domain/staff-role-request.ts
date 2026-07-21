import type { Role, RoleRequestStatus } from '@prisma/client';

export const STAFF_ROLE_REQUEST_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REVOKE: 'REVOKE',
} as const;

export type StaffRoleRequestAction =
  | { readonly action: typeof STAFF_ROLE_REQUEST_ACTIONS.APPROVE }
  | {
      readonly action: typeof STAFF_ROLE_REQUEST_ACTIONS.REJECT;
      readonly reason: string;
    }
  | { readonly action: typeof STAFF_ROLE_REQUEST_ACTIONS.REVOKE };

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
  readonly nextRole: Role | null;
}
