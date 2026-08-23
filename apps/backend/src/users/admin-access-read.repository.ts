import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { userProfileNameWhere } from '../profiles/user-profile-read';
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
    // 표시 역할 집계는 canonical 세 사실을 `authorityLabel`과 같은 우선순위로 되짚는다.
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
        staffAccessRequests: { none: { status: StaffAccessRequestStatus.PENDING } },
      },
    }),
    prisma.user.count({
      where: {
        ...pendingRequestBase,
        staffAccessRequests: { some: { status: StaffAccessRequestStatus.PENDING } },
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
  const clauses: Prisma.UserWhereInput[] = [];
  if (query.query) {
    clauses.push({
      OR: [
        userProfileNameWhere(query.query),
        {
          nickname: {
            contains: query.query,
            mode: 'insensitive' as const,
          },
        },
      ],
    });
  }
  // 표시 역할 필터는 canonical 세 사실을 `authorityLabel`과 같은 우선순위로 되짚는다.
  // 검색어의 OR와 미배정 필터의 OR가 한 객체에서 덮어쓰지 않도록 AND로 묶는다.
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

/** 표시 역할 필터를 canonical 컬럼 조건으로 되짚는다. `authorityLabel`과 같은 우선순위다. */
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
