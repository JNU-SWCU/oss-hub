import type { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';

export type SelectableRole = typeof Role.STUDENT | typeof Role.STAFF;

export type RoleUser = {
  readonly id: string;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
};

export type RoleRequestRecord = {
  readonly id: string;
  readonly userId: string;
  readonly status: RoleRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
};

export type RoleSelectionResult = {
  readonly selectedRole: SelectableRole;
  readonly role: Role | null;
  readonly requestStatus: RoleRequestStatus | null;
  readonly redirectTo: '/programs' | '/onboarding/pending';
};
