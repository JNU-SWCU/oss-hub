import { AffiliationKind, MemberKind } from '@prisma/client';
import type { CompleteUserProfileInput } from './domain/user-profile';
import type { UserProfileRecord } from './user-profile-policy';

type LegacyProfileWrite = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
};

export function canonicalCompletion(
  profile: LegacyProfileWrite,
  memberKind: MemberKind = MemberKind.STUDENT,
  affiliationKind: AffiliationKind = AffiliationKind.DEPARTMENT,
): CompleteUserProfileInput {
  return {
    ...profile,
    memberKind,
    affiliationKind,
    affiliationName: profile.department,
    hasStaffAccess: false,
    hasAdminAccess: false,
  };
}

export function profileRecord(
  id: string,
  profile: Partial<UserProfileRecord> = {},
): UserProfileRecord {
  return {
    id,
    selectedMemberKind: MemberKind.STUDENT,
    memberKind: null,
    affiliationKind: null,
    affiliationName: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    name: null,
    studentId: null,
    department: null,
    ...profile,
  };
}
