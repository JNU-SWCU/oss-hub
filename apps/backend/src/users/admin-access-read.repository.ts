import {
  AccountStatus,
  MemberKind,
  StaffAccessRequestStatus,
  type Prisma,
} from '@prisma/client';
import { UserProfileReadRepository } from '../platform/user-profile-read.repository';
import type { PrismaService } from '../platform/prisma.service';
import {
  AdminAccessReadOrderingRepository,
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  type AdminAccessFacets,
  type AdminAccessListQuery,
} from './admin-access-read-ordering.repository';
import {
  ADMIN_ACCESS_USER_SELECT,
  AdminAccessUserProjectionRepository,
  type AdminAccessUserDetailRecord,
  type AdminAccessUserPageRecord,
} from './admin-access-user-projection.repository';

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
            select: ADMIN_ACCESS_USER_SELECT,
          });
    const usersById = new Map(users.map((user) => [user.id, user] as const));
    return {
      items: ids.flatMap((id) => {
        const user = usersById.get(id);
        return user
          ? [AdminAccessUserProjectionRepository.toAdminAccessUserRecord(user)]
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
      select: ADMIN_ACCESS_USER_SELECT,
    });
    return user
      ? AdminAccessUserProjectionRepository.toAdminAccessUserDetailRecord(user)
      : null;
  }
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
        UserProfileReadRepository.userProfileNameWhere(query.query),
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
