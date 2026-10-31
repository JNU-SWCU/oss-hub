import {
  LoginHistoryEvent,
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
  Prisma,
} from '@prisma/client';
import { USER_PROFILE_SELECT } from '../platform/user-profile-read.config';
import { authorityLabel } from './authority-label.config';
import type { PrismaService } from '../platform/prisma.service';
import {
  AdminAccessReadOrderingRepository,
  type AdminAccessFacets,
  type AdminAccessListQuery,
  type AdminAccessLoginHistoryPage,
  type AdminAccessStaffAccessRequestHistoryPage,
  type AdminAccessUser,
  type AdminAccessUserDetail,
} from './admin-access-read-ordering.repository';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
} from './admin-access-query.config';

import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import {
  isCompleteUserProfile,
  type UserProfileFields,
} from './profile-validation.config';
import type { AuthorityLabel } from './authority-label.types';
import type { UserProfileSource } from '../platform/user-profile-read.config';
import { PlatformRepository } from '../platform/platform.repository';

export class AdminAccessReadRepository {
  static async listAdminAccessUsers(
    prisma: Pick<PrismaService, 'user' | '$queryRaw'>,
    query: AdminAccessListQuery,
    sortContext: 'directory' | 'requestQueue' = 'directory',
  ): Promise<AdminAccessUserPageRecord> {
    const where = adminAccessWhere(query);
    const [orderedIds, total, facets] = await Promise.all([
      AdminAccessReadOrderingRepository.listOrderedAdminAccessUserIds(
        prisma,
        query,
        sortContext,
      ),
      prisma.user.count({ where }),
      AdminAccessReadRepository.listAdminAccessFacets(prisma, query),
    ]);
    const ids = orderedIds.map(({ id }) => id);
    const users =
      ids.length === 0
        ? []
        : await prisma.user.findMany({
            where: { AND: [where, { id: { in: ids } }] },
            select: AdminAccessReadRepository.ADMIN_ACCESS_USER_SELECT,
          });
    const usersById = new Map(users.map((user) => [user.id, user] as const));
    return {
      items: ids.flatMap((id) => {
        const user = usersById.get(id);
        return user
          ? [AdminAccessReadRepository.toAdminAccessUserRecord(user)]
          : [];
      }),
      page: query.page,
      limit: query.limit,
      total,
      facets,
    };
  }

  static async listAdminAccessFacets(
    prisma: Pick<PrismaService, 'user'>,
    query: AdminAccessListQuery,
  ): Promise<AdminAccessFacets> {
    const roleBase = adminAccessWhere(query, 'role');
    const accountStatusBase = adminAccessWhere(query, 'accountStatus');
    const pendingRequestBase = adminAccessWhere(query, 'pendingRequest');
    const [
      unassigned,
      student,
      staff,
      admin,
      active,
      deactivated,
      none,
      pending,
    ] = await Promise.all([
      prisma.user.count({
        where: {
          AND: [
            roleBase,
            {
              hasStaffAccess: false,
              hasAdminAccess: false,
              OR: [
                { profile: { is: null } },
                { profile: { isNot: { memberKind: MemberKind.STUDENT } } },
              ],
            },
          ],
        },
      }),
      prisma.user.count({
        where: {
          ...roleBase,
          hasStaffAccess: false,
          hasAdminAccess: false,
          profile: { is: { memberKind: MemberKind.STUDENT } },
        },
      }),
      prisma.user.count({
        where: { ...roleBase, hasStaffAccess: true, hasAdminAccess: false },
      }),
      prisma.user.count({ where: { ...roleBase, hasAdminAccess: true } }),
      prisma.user.count({
        where: { ...accountStatusBase, accountStatus: AccountStatus.ACTIVE },
      }),
      prisma.user.count({
        where: {
          ...accountStatusBase,
          accountStatus: AccountStatus.DEACTIVATED,
        },
      }),
      prisma.user.count({
        where: {
          ...pendingRequestBase,
          staffAccessRequests: {
            none: { status: StaffAccessRequestStatus.PENDING },
          },
        },
      }),
      prisma.user.count({
        where: {
          ...pendingRequestBase,
          staffAccessRequests: {
            some: { status: StaffAccessRequestStatus.PENDING },
          },
        },
      }),
    ]);
    return {
      roles: { unassigned, student, staff, admin },
      accountStatuses: { active, deactivated },
      pendingRequests: { none, pending },
    };
  }

  static async findAdminAccessUserById(
    prisma: Pick<PrismaService, 'user'>,
    userId: string,
  ): Promise<AdminAccessUserDetailRecord | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: AdminAccessReadRepository.ADMIN_ACCESS_USER_SELECT,
    });
    return user
      ? AdminAccessReadRepository.toAdminAccessUserDetailRecord(user)
      : null;
  }

  static toAdminAccessUserRecord(
    user: AdminAccessUserSource,
  ): AdminAccessUserRecord {
    const profile = {
      name: user.profile?.name ?? null,
      studentId: user.profile?.studentId ?? null,
      department: user.profile?.department ?? null,
    };
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
    const profile = {
      name: user.profile?.name ?? null,
      studentId: user.profile?.studentId ?? null,
      department: user.profile?.department ?? null,
    };
    return {
      ...AdminAccessReadRepository.toAdminAccessUserRecord(user),
      profile: {
        ...profile,
        staffNumber: user.profile?.staffNumber ?? null,
        isComplete: isCompleteAdminAccessProfile(user, profile),
      },
    };
  }

  static readonly ADMIN_ACCESS_USER_SELECT = {
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
}

type FacetDimension = 'role' | 'accountStatus' | 'pendingRequest';

function adminAccessWhere(
  query: AdminAccessListQuery,
  omitted?: FacetDimension,
): Prisma.UserWhereInput {
  const clauses: Prisma.UserWhereInput[] = [];
  if (query.query) {
    clauses.push({
      OR: [
        PlatformRepository.userProfileNameWhere(query.query),
        {
          nickname: {
            contains: query.query,
            mode: 'insensitive' as const,
          },
        },
      ],
    });
  }

  if (omitted !== 'role' && query.role !== undefined) {
    clauses.push(adminAccessRoleFilterWhere(query.role));
  }
  if (omitted !== 'accountStatus' && query.accountStatus !== undefined) {
    clauses.push({ accountStatus: query.accountStatus });
  }
  if (omitted !== 'pendingRequest' && query.pendingRequest !== undefined) {
    clauses.push({
      staffAccessRequests:
        query.pendingRequest === ADMIN_ACCESS_PENDING_FILTERS.PENDING
          ? { some: { status: StaffAccessRequestStatus.PENDING } }
          : { none: { status: StaffAccessRequestStatus.PENDING } },
    });
  }
  if (clauses.length === 0) {
    return {};
  }
  if (clauses.length === 1) {
    return clauses[0] ?? {};
  }
  return { AND: clauses };
}

function adminAccessRoleFilterWhere(
  filter: NonNullable<AdminAccessListQuery['role']>,
): Prisma.UserWhereInput {
  switch (filter) {
    case ADMIN_ACCESS_ROLE_FILTERS.ADMIN:
      return { hasAdminAccess: true };
    case ADMIN_ACCESS_ROLE_FILTERS.STAFF:
      return { hasStaffAccess: true, hasAdminAccess: false };
    case ADMIN_ACCESS_ROLE_FILTERS.STUDENT:
      return {
        hasStaffAccess: false,
        hasAdminAccess: false,
        profile: { is: { memberKind: MemberKind.STUDENT } },
      };
    case ADMIN_ACCESS_ROLE_FILTERS.UNASSIGNED:
      return {
        hasStaffAccess: false,
        hasAdminAccess: false,
        OR: [
          { profile: { is: null } },
          { profile: { isNot: { memberKind: MemberKind.STUDENT } } },
        ],
      };
  }
}

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

type PrismaAdminAccessUser = Prisma.UserGetPayload<{
  select: typeof AdminAccessReadRepository.ADMIN_ACCESS_USER_SELECT;
}>;

export type AdminAccessUserSource = Omit<PrismaAdminAccessUser, 'profile'> &
  UserProfileSource;

export type AdminAccessUserDetailSource = AdminAccessUserSource & {
  readonly profile:
    | (NonNullable<UserProfileSource['profile']> & {
        readonly staffNumber: string | null;
      })
    | null;
};

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
