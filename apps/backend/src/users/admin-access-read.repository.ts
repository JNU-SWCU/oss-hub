import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { compatibleProfileNameWhere } from '../profiles/profile-compatibility';
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
} from './admin-access.repository.types';
import { listOrderedAdminAccessUserIds } from './admin-access-read-ordering';
import {
  ADMIN_ACCESS_USER_SELECT,
  toAdminAccessUserDetailRecord,
  toAdminAccessUserRecord,
} from './admin-access-user-projection.repository';

export {
  ADMIN_ACCESS_USER_SELECT,
  toAdminAccessUserRecord,
} from './admin-access-user-projection.repository';

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
