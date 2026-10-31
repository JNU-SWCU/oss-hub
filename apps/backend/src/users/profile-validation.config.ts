import { MemberKind, type AffiliationKind } from '@prisma/client';

export interface UserProfileRecord {
  readonly id: string;
  readonly githubId?: bigint;
  readonly githubLogin?: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly phone?: string | null;

  readonly staffNumber?: string | null;

  readonly hasPendingStaffRequest?: boolean;

  readonly selectedMemberKind?: MemberKind | null;
  readonly memberKind?: MemberKind | null;
  readonly affiliationKind?: AffiliationKind | null;
  readonly affiliationName?: string | null;
  readonly hasStaffAccess?: boolean;
  readonly hasAdminAccess?: boolean;
}

export type UserProfileFields = Pick<
  UserProfileRecord,
  'name' | 'studentId' | 'department'
>;

export const USER_NAME_MAX_LENGTH = 100;

export const USER_DEPARTMENT_MAX_LENGTH = 100;

export const PROFILE_TEXT_PATTERN = /^[\s\S]{1,100}$/u;

export interface ProfileFieldRequirement {
  readonly studentId: boolean;
  readonly department: boolean;
}
