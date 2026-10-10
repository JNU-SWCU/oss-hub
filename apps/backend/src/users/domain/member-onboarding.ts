import type {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';

export type SelectableMemberKind = MemberKind;

export type MemberProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type MemberUser = {
  readonly id: string;

  readonly memberKind: MemberKind | null;

  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;

  readonly profile: MemberProfileFields;
};

export type StaffAccessRequestRecord = {
  readonly id: string;
  readonly userId: string;
  readonly status: StaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
};

export type MemberKindSelectionResult = {
  readonly selectedMemberKind: SelectableMemberKind;

  readonly redirectTo: '/onboarding/profile';
};

export type MemberKindSelectionState = {
  readonly selectedMemberKind: SelectableMemberKind | null;
};
