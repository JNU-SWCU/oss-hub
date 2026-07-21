export type RoleSelection = 'STUDENT' | 'STAFF';

export type RoleRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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
