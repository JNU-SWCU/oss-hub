import { LoginHistoryEvent, StaffAccessRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { authorityLabel } from './domain/authority-label';
import {
  USER_PROFILE_SELECT,
  resolveUserProfile,
  type UserProfileSource,
} from '../profiles/user-profile-read';
import type {
  AdminAccessUserDetailRecord,
  AdminAccessUserRecord,
} from './admin-access.repository.types';
import {
  isCompleteUserProfile,
  type UserProfileFields,
} from './user-profile-policy';

export const ADMIN_ACCESS_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  ...USER_PROFILE_SELECT,
  staffAccessRequests: {
    where: { status: StaffAccessRequestStatus.PENDING },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { id: true, status: true, createdAt: true },
  },
  loginHistories: {
    where: { event: LoginHistoryEvent.LOGIN, success: true },
    orderBy: [{ loginAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { loginAt: true },
  },
} as const satisfies Prisma.UserSelect;

type PrismaAdminAccessUser = Prisma.UserGetPayload<{
  select: typeof ADMIN_ACCESS_USER_SELECT;
}>;

export type AdminAccessUserSource = Omit<PrismaAdminAccessUser, 'profile'> &
  UserProfileSource;

export function toAdminAccessUserRecord(
  user: AdminAccessUserSource,
): AdminAccessUserRecord {
  const profile = resolveUserProfile(user);
  const memberKind = user.profile?.memberKind ?? null;
  const pendingRequest = user.staffAccessRequests[0];
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: profile.name,
    role: authorityLabel({ ...user, memberKind }),
    memberKind,
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    accountStatus: user.accountStatus,
    isProfileComplete: isCompleteAdminAccessProfile(user, profile),
    pendingRequest: pendingRequest
      ? {
          id: pendingRequest.id,
          status: StaffAccessRequestStatus.PENDING,
          createdAt: pendingRequest.createdAt,
        }
      : null,
    lastLoginAt: user.loginHistories[0]?.loginAt ?? null,
  };
}

export function toAdminAccessUserDetailRecord(
  user: AdminAccessUserSource,
): AdminAccessUserDetailRecord {
  const profile = resolveUserProfile(user);
  return {
    ...toAdminAccessUserRecord(user),
    profile: {
      ...profile,
      isComplete: isCompleteAdminAccessProfile(user, profile),
    },
  };
}

function isCompleteAdminAccessProfile(
  user: AdminAccessUserSource,
  profile: UserProfileFields,
): boolean {
  return isCompleteUserProfile({
    id: user.id,
    ...profile,
    memberKind: user.profile?.memberKind ?? null,
    hasPendingStaffRequest: user.staffAccessRequests.length > 0,
    selectedMemberKind: user.selectedMemberKind,
  });
}
