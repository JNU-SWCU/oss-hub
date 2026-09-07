import { Prisma, StaffAccessRequestStatus } from '@prisma/client';
import type { UserProfileRecord } from './domain/user-profile';

export const PROFILE_MEMBER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  phone: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
      affiliationKind: true,
      affiliationName: true,
    },
  },
  staffAccessRequests: {
    where: { status: StaffAccessRequestStatus.PENDING },
    select: { id: true },
    take: 1,
  },
} as const satisfies Prisma.UserSelect;

type ProfileMemberRow = Prisma.UserGetPayload<{
  select: typeof PROFILE_MEMBER_SELECT;
}>;

export function toUserProfileRecord(user: ProfileMemberRow): UserProfileRecord {
  const profile = user.profile;
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: profile?.name ?? null,
    studentId: profile?.studentId ?? null,
    department: profile?.department ?? null,
    phone: user.phone ?? null,
    selectedMemberKind: user.selectedMemberKind,
    memberKind: profile?.memberKind ?? null,
    affiliationKind: profile?.affiliationKind ?? null,
    affiliationName: profile?.affiliationName ?? null,
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    hasPendingStaffRequest: user.staffAccessRequests.length > 0,
  };
}

export function sameProfileSnapshot(
  current: UserProfileRecord,
  expected: UserProfileRecord,
): boolean {
  return (
    current.name === expected.name &&
    current.studentId === expected.studentId &&
    current.department === expected.department &&
    current.phone === expected.phone &&
    current.selectedMemberKind === expected.selectedMemberKind &&
    current.memberKind === expected.memberKind &&
    current.affiliationKind === expected.affiliationKind &&
    current.affiliationName === expected.affiliationName &&
    current.hasStaffAccess === expected.hasStaffAccess &&
    current.hasAdminAccess === expected.hasAdminAccess
  );
}
