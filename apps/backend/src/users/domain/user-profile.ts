import type { AffiliationKind, MemberKind } from '@prisma/client';
import {
  isCompleteUserProfile,
  type UserProfileRecord,
} from '../user-profile-policy';

export {
  effectiveProfileMemberKind,
  isCompleteProfileFields,
  isCompleteUserProfile,
  isValidDepartment,
  isValidPhone,
  isValidStudentId,
  isValidUserName,
  normalizeProfileText,
  profileFieldRequirement,
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
  type ProfileFieldRequirement,
  type UserProfileRecord,
} from '../user-profile-policy';

export interface UserProfile {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly phone: string | null;
  readonly staffNumber: string | null;
  readonly isComplete: boolean;
}

export interface CompleteUserProfileInput {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly phone?: string;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
}

export interface PatchUserProfileInput {
  readonly name: string;
  readonly studentId?: string;
  readonly department?: string;
  readonly phone?: string;
  readonly staffNumber?: string | null;
  readonly affiliationKind?: AffiliationKind;
  readonly affiliationName?: string;
}

export interface UpdateProfileFieldsInput {
  readonly name: string;
  readonly department: string;
  readonly phone?: string;
  readonly staffNumber?: string | null;
  readonly affiliationKind?: AffiliationKind;
  readonly affiliationName?: string;
}

export function toUserProfile(record: UserProfileRecord): UserProfile {
  return {
    name: record.name ?? '',
    studentId: record.studentId,
    department: record.department,
    phone: record.phone ?? null,
    staffNumber: record.staffNumber ?? null,
    isComplete: isCompleteUserProfile(record),
  };
}

export type NormalizedProfileRecord = Omit<
  UserProfileRecord,
  'name' | 'department'
> & {
  readonly name: string;
  readonly department: string;
};

export function nextProfileRecord(
  user: UserProfileRecord,
  input: CompleteUserProfileInput,
): NormalizedProfileRecord {
  return {
    ...user,
    name: input.name,
    studentId: input.studentId,
    department: input.department,
    phone: input.phone ?? user.phone,
    memberKind: input.memberKind,
    affiliationKind: input.affiliationKind,
    affiliationName: input.affiliationName,
    hasStaffAccess: input.hasStaffAccess,
    hasAdminAccess: input.hasAdminAccess,
  };
}
