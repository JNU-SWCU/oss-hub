import {
  authorityLabel,
  isCompleteUserProfile,
  type UserProfileFields,
} from './users.repository';
import { type AuthorityLabel } from './authority-label.types';
import {
  LoginHistoryEvent,
  StaffAccessRequestStatus,
  type Prisma,
  type AccountStatus,
  type MemberKind,
} from '@prisma/client';
import {
  USER_PROFILE_SELECT,
  type UserProfileSource,
  UserProfileReadRepository,
} from '../platform/user-profile-read.repository';
import {
  type AdminAccessUser,
  type AdminAccessUserDetail,
  type AdminAccessFacets,
  type AdminAccessListQuery,
  type AdminAccessStaffAccessRequestHistoryPage,
  type AdminAccessLoginHistoryPage,
} from './admin-access-read-ordering.repository';
import { type AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';

export type AdminAccessActor = {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;

  readonly role: AuthorityLabel | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
};

export type AdminAccessUserRecord = Omit<AdminAccessUser, 'isSelf'> & {
  readonly githubId: bigint;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type AdminAccessUserDetailRecord = Omit<
  AdminAccessUserDetail,
  'isSelf'
> & {
  readonly githubId: bigint;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type AdminAccessUserPageRecord = {
  readonly items: readonly AdminAccessUserRecord[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacets;
};

export type AdminAccessUserUpdate = {
  readonly userId: string;

  readonly expectedHasStaffAccess: boolean;
  readonly expectedHasAdminAccess: boolean;
  readonly expectedAccountStatus: AccountStatus;
  readonly desiredAccountStatus: AccountStatus;
  readonly desiredHasStaffAccess: boolean;
  readonly desiredHasAdminAccess: boolean;
};

export type AdminAccessPendingDecisionUpdate = {
  readonly requestId: string;
  readonly actorId: string;
  readonly nextStatus:
    | typeof StaffAccessRequestStatus.APPROVED
    | typeof StaffAccessRequestStatus.REJECTED;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date;
};

export type AdminAccessRevokedRequestInsert = {
  readonly userId: string;
  readonly actorId: string;
  readonly decidedAt: Date;
};

export type AdminAccessInsertedRequest = {
  readonly id: string;
};

export interface AdminAccessTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  lockActiveAdmins(): Promise<number>;
  findUserForUpdate(userId: string): Promise<AdminAccessUserRecord | null>;
  compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean>;
  decidePendingRequest(
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean>;

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest>;
}

export interface AdminAccessRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T>;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  list(
    query: AdminAccessListQuery,
    sortContext?: 'directory' | 'requestQueue',
  ): Promise<AdminAccessUserPageRecord>;
  facets(query: AdminAccessListQuery): Promise<AdminAccessFacets>;
  findById(userId: string): Promise<AdminAccessUserDetailRecord | null>;
  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage>;
  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage>;
}

export const ADMIN_ACCESS_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  selectedMemberKind: true,
  createdAt: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  ...USER_PROFILE_SELECT,
  profile: {
    select: {
      ...USER_PROFILE_SELECT.profile.select,
      staffNumber: true,
    },
  },
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

type AdminAccessUserDetailSource = AdminAccessUserSource & {
  readonly profile:
    | (NonNullable<UserProfileSource['profile']> & {
        readonly staffNumber: string | null;
      })
    | null;
};

export class AdminAccessUserProjectionRepository {
  static toAdminAccessUserRecord(
    user: AdminAccessUserSource,
  ): AdminAccessUserRecord {
    const profile = UserProfileReadRepository.resolveUserProfile(user);
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
      createdAt: user.createdAt,
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

  static toAdminAccessUserDetailRecord(
    user: AdminAccessUserDetailSource,
  ): AdminAccessUserDetailRecord {
    const profile = UserProfileReadRepository.resolveUserProfile(user);
    return {
      ...AdminAccessUserProjectionRepository.toAdminAccessUserRecord(user),
      profile: {
        ...profile,
        staffNumber: user.profile?.staffNumber ?? null,
        isComplete: isCompleteAdminAccessProfile(user, profile),
      },
    };
  }
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
