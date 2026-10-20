export type RoleSelection = 'STUDENT' | 'STAFF';

export type StaffAccessRequestStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface RoleSelectionResult {
  readonly selectedRole: RoleSelection;

  readonly redirectTo: '/onboarding/profile';
}

export interface RoleSelectionState {
  readonly selectedRole: RoleSelection | null;
}

export interface StaffAccessRequest {
  readonly requestedRole: 'STAFF';
  readonly status: StaffAccessRequestStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly rejectionReason: string | null;
}
