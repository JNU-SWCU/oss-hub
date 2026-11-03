import { DepartmentType, MemberKind } from './user-contract.config';
import { type CompleteUserProfileInput } from './users.repository';
import { type UserProfileRecord } from './profile-validation.config';
type LegacyProfileWrite = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
};
export function canonicalCompletion(
  profile: LegacyProfileWrite,
  memberKind: MemberKind = MemberKind.STUDENT,
  departmentType: DepartmentType = DepartmentType.DEPARTMENT,
): CompleteUserProfileInput {
  return {
    ...profile,
    memberKind,
    departmentType,
    department: profile.department,
    requestsStaffAccess: memberKind === MemberKind.STAFF,
  };
}
export function profileRecord(
  id: string,
  profile: Partial<UserProfileRecord> & {
    readonly hasStaffAccess?: boolean;
  } = {},
): UserProfileRecord {
  const { hasStaffAccess = false, ...raw } = profile;
  const kind =
    raw.memberKind === undefined
      ? (raw.selectedMemberKind ?? 'STUDENT')
      : raw.memberKind;
  return {
    id,
    githubId: 4242n,
    githubLogin: id,
    selectedMemberKind: kind,
    memberKind: kind,
    departmentType: null,
    hasAdminAccess: false,
    name: null,
    studentId: null,
    staffNumber: null,
    department: null,
    phone: null,
    profileCreatedAt: raw.name == null ? null : new Date('2026-01-01'),
    approvalStatus: hasStaffAccess
      ? 'APPROVED'
      : kind === 'STAFF'
        ? 'PENDING'
        : 'NOT_REQUIRED',
    approvalRequestId: null,
    ...raw,
  };
}
