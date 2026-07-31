import {
  AccountStatus,
  LoginHistoryEvent,
  Role,
  RoleRequestStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  compatibleProfileNameWhere,
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
} from '../profiles/profile-compatibility';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  type AdminAccessFacets,
  type AdminAccessListQuery,
} from './domain/admin-access';
import type {
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
} from './admin-access.repository.types';
import { listOrderedAdminAccessUserIds } from './admin-access-read-ordering';
import { isCompleteUserProfile } from './user-profile-policy';

export const ADMIN_ACCESS_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  role: true,
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

export async function listAdminAccessUsers(
  prisma: Pick<PrismaService, 'user' | '$queryRaw'>,
  query: AdminAccessListQuery,
): Promise<AdminAccessUserPageRecord> {
  const where = adminAccessWhere(query);
  const [orderedIds, total, facets] = await Promise.all([
    listOrderedAdminAccessUserIds(prisma, query),
    prisma.user.count({ where }),
    listAdminAccessFacets(prisma, query),
  ]);
  const ids = orderedIds.map(({ id }) => id);
  const users =
    ids.length === 0
      ? []
      : await prisma.user.findMany({
          where: { AND: [where, { id: { in: ids } }] },
          select: ADMIN_ACCESS_USER_SELECT,
        });
  const usersById = new Map(users.map((user) => [user.id, user] as const));
  return {
    items: ids.flatMap((id) => {
      const user = usersById.get(id);
      return user ? [toAdminAccessUserRecord(user)] : [];
    }),
    page: query.page,
    limit: query.limit,
    total,
    facets,
  };
}

export async function listAdminAccessFacets(
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
    prisma.user.count({ where: { ...roleBase, role: null } }),
    prisma.user.count({ where: { ...roleBase, role: Role.STUDENT } }),
    prisma.user.count({ where: { ...roleBase, role: Role.STAFF } }),
    prisma.user.count({ where: { ...roleBase, role: Role.ADMIN } }),
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
        roleRequests: { none: { status: RoleRequestStatus.PENDING } },
      },
    }),
    prisma.user.count({
      where: {
        ...pendingRequestBase,
        roleRequests: { some: { status: RoleRequestStatus.PENDING } },
      },
    }),
  ]);
  return {
    roles: { unassigned, student, staff, admin },
    accountStatuses: { active, deactivated },
    pendingRequests: { none, pending },
  };
}

export async function findAdminAccessUserById(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
): Promise<AdminAccessUserDetailRecord | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: ADMIN_ACCESS_USER_SELECT,
  });
  return user ? toAdminAccessUserDetailRecord(user) : null;
}

export function toAdminAccessUserRecord(
  user: PrismaAdminAccessUser,
): AdminAccessUserRecord {
  const profile = resolveCompatibleProfile(user);
  const pendingRequest = user.roleRequests[0];
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: profile.name,
    role: user.role,
    accountStatus: user.accountStatus,
    isProfileComplete: isCompleteUserProfile({ id: user.id, ...profile }),
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

function toAdminAccessUserDetailRecord(
  user: PrismaAdminAccessUser,
): AdminAccessUserDetailRecord {
  const profile = resolveCompatibleProfile(user);
  return {
    ...toAdminAccessUserRecord(user),
    profile: {
      ...profile,
      isComplete: isCompleteUserProfile({ id: user.id, ...profile }),
    },
  };
}

type FacetDimension = 'role' | 'accountStatus' | 'pendingRequest';

function adminAccessWhere(
  query: AdminAccessListQuery,
  omitted?: FacetDimension,
): Prisma.UserWhereInput {
  const profileConditions = query.query
    ? (compatibleProfileNameWhere(query.query).OR ?? [])
    : [];
  return {
    ...(query.query
      ? {
          OR: [
            ...profileConditions,
            {
              nickname: {
                contains: query.query,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {}),
    ...(omitted === 'role' || query.role === undefined
      ? {}
      : {
          role:
            query.role === ADMIN_ACCESS_ROLE_FILTERS.UNASSIGNED
              ? null
              : query.role,
        }),
    ...(omitted === 'accountStatus' || query.accountStatus === undefined
      ? {}
      : { accountStatus: query.accountStatus }),
    ...(omitted === 'pendingRequest' || query.pendingRequest === undefined
      ? {}
      : {
          roleRequests:
            query.pendingRequest === ADMIN_ACCESS_PENDING_FILTERS.PENDING
              ? { some: { status: RoleRequestStatus.PENDING } }
              : { none: { status: RoleRequestStatus.PENDING } },
        }),
  };
}
