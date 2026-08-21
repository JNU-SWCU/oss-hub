import { LoginHistoryEvent, RoleRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { resolveMemberAuthorityCompatibility } from '../profiles/member-authority-compatibility';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
  type CompatibleProfileSource,
} from '../profiles/profile-compatibility';
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
  role: true,
  selectedRole: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  ...COMPATIBLE_PROFILE_SELECT,
  roleRequests: {
    where: { status: RoleRequestStatus.PENDING },
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

export type AdminAccessUserSource = Omit<
  PrismaAdminAccessUser,
  | 'name'
  | 'studentId'
  | 'department'
  | 'profile'
  | 'selectedMemberKind'
  | 'hasStaffAccess'
  | 'hasAdminAccess'
> &
  CompatibleProfileSource & {
    readonly selectedMemberKind?: PrismaAdminAccessUser['selectedMemberKind'];
    readonly hasStaffAccess?: boolean | null;
    readonly hasAdminAccess?: boolean | null;
  };

export function toAdminAccessUserRecord(
  user: AdminAccessUserSource,
): AdminAccessUserRecord {
  const profile = resolveCompatibleProfile(user);
  const authority = resolveMemberAuthorityCompatibility(user);
  const pendingRequest = user.roleRequests[0];
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: profile.name,
    role: user.role,
    memberKind: authority.memberKind,
    hasStaffAccess: authority.hasStaffAccess,
    hasAdminAccess: authority.hasAdminAccess,
    accountStatus: user.accountStatus,
    isProfileComplete: isCompleteAdminAccessProfile(user, profile),
    pendingRequest: pendingRequest
      ? {
          id: pendingRequest.id,
          status: RoleRequestStatus.PENDING,
          createdAt: pendingRequest.createdAt,
        }
      : null,
    lastLoginAt: user.loginHistories[0]?.loginAt ?? null,
  };
}

export function toAdminAccessUserDetailRecord(
  user: AdminAccessUserSource,
): AdminAccessUserDetailRecord {
  const profile = resolveCompatibleProfile(user);
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
    role: user.role,
    hasPendingStaffRequest: user.roleRequests.length > 0,
    selectedRole: user.selectedRole,
  });
}
