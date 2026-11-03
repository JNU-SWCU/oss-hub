import type { Admin, ApprovalStatus } from '@prisma/client';
import { StaffAccessRequestStatus, MemberKind } from './user-contract.config';
import { Injectable } from '@nestjs/common';
import type { AuthorityLabel } from './authority-label.types';
import { AccountStatus, LoginHistoryEvent, Prisma } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import {
  ADMIN_ACCESS_SORT_FIELDS,
  ADMIN_ACCESS_SORT_DIRECTIONS,
  ADMIN_ACCESS_ROLE_FILTERS,
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_DEFAULT_SORT,
  ADMIN_ACCESS_DEFAULT_DIRECTION,
} from './admin-access-query.config';

export type AdminAccessPendingRequest = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: Date;
};

export type AdminAccessRoleFilter =
  (typeof ADMIN_ACCESS_ROLE_FILTERS)[keyof typeof ADMIN_ACCESS_ROLE_FILTERS];

export type AdminAccessPendingFilter =
  (typeof ADMIN_ACCESS_PENDING_FILTERS)[keyof typeof ADMIN_ACCESS_PENDING_FILTERS];

export type AdminAccessSortField =
  (typeof ADMIN_ACCESS_SORT_FIELDS)[keyof typeof ADMIN_ACCESS_SORT_FIELDS];

export type AdminAccessSortDirection =
  (typeof ADMIN_ACCESS_SORT_DIRECTIONS)[keyof typeof ADMIN_ACCESS_SORT_DIRECTIONS];

export type AdminAccessListQuery = {
  readonly query: string;
  readonly role?: AdminAccessRoleFilter;
  readonly accountStatus?: AccountStatus;
  readonly pendingRequest?: AdminAccessPendingFilter;
  readonly sort?: AdminAccessSortField;
  readonly direction?: AdminAccessSortDirection;
  readonly page: number;
  readonly limit: number;
};

type AdminAccessProfile = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly staffNumber: string | null;
  readonly department: string | null;
  readonly isComplete: boolean;
};

export type AdminAccessUser = {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AuthorityLabel | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly approvalStatus: ApprovalStatus;
  readonly approvalRequestId: string | null;
  readonly accountStatus: AccountStatus;
  readonly isSelf: boolean;
  readonly isProfileComplete: boolean;
  readonly createdAt: Date;
  readonly pendingRequest: AdminAccessPendingRequest | null;
  readonly lastLoginAt: Date | null;
};

export type AdminAccessFacets = {
  readonly roles: {
    readonly unassigned: number;
    readonly student: number;
    readonly staff: number;
    readonly admin: number;
  };
  readonly accountStatuses: {
    readonly active: number;
    readonly deactivated: number;
  };
  readonly pendingRequests: {
    readonly none: number;
    readonly pending: number;
  };
};

export type AdminAccessUserPage = {
  readonly items: readonly AdminAccessUser[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly facets: AdminAccessFacets;
};

export type AdminAccessUserDetail = AdminAccessUser & {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly adminGrant: Pick<Admin, 'origin' | 'grantedAt'> | null;
  readonly profile: AdminAccessProfile;
};

type AdminAccessStaffAccessRequestHistoryItem = {
  readonly id: string;
  readonly status: StaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly createdAt: Date;
};

export type AdminAccessStaffAccessRequestHistoryPage = {
  readonly items: readonly AdminAccessStaffAccessRequestHistoryItem[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
};

type AdminAccessLoginHistoryItem = {
  readonly id: string;
  readonly event: LoginHistoryEvent;
  readonly provider: 'github';
  readonly success: boolean;
  readonly loginAt: Date;
};

export type AdminAccessLoginHistoryPage = {
  readonly items: readonly AdminAccessLoginHistoryItem[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
};

export type AdminAccessHistoryQuery = {
  readonly staffAccessRequests: {
    readonly page: number;
    readonly limit: number;
  };
  readonly loginHistory: { readonly page: number; readonly limit: number };
};

export type AdminAccessUserHistory = {
  readonly staffAccessRequests: AdminAccessStaffAccessRequestHistoryPage;
  readonly loginHistory: AdminAccessLoginHistoryPage;
};

type OrderedAdminAccessUserId = { readonly id: string };
type AdminAccessListSortContext = 'directory' | 'requestQueue';

const ORDER_DIRECTIONS = {
  [ADMIN_ACCESS_SORT_DIRECTIONS.ASC]: Prisma.sql`ASC`,
  [ADMIN_ACCESS_SORT_DIRECTIONS.DESC]: Prisma.sql`DESC`,
} as const satisfies Readonly<Record<AdminAccessSortDirection, Prisma.Sql>>;

@Injectable()
export class AdminAccessReadOrderingRepository {
  listOrderedAdminAccessUserIds(
    prisma: Pick<PrismaService, '$queryRaw'>,
    query: AdminAccessListQuery,
    sortContext: AdminAccessListSortContext = 'directory',
  ): Promise<readonly OrderedAdminAccessUserId[]> {
    const offset = (query.page - 1) * query.limit;
    const where = adminAccessSqlWhere(query);
    const orderBy = adminAccessOrderBy(query, sortContext);
    return prisma.$queryRaw<readonly OrderedAdminAccessUserId[]>(Prisma.sql`
    SELECT u."id"
    FROM "User" AS u
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${query.limit}
    OFFSET ${offset}
  `);
  }
}

function adminAccessOrderBy(
  query: AdminAccessListQuery,
  sortContext: AdminAccessListSortContext,
): Prisma.Sql {
  const sort = query.sort ?? ADMIN_ACCESS_DEFAULT_SORT;
  const direction = query.direction ?? ADMIN_ACCESS_DEFAULT_DIRECTION;
  const directionSql = ORDER_DIRECTIONS[direction];
  const orderings = {
    [ADMIN_ACCESS_SORT_FIELDS.NAME]: Prisma.sql`
      u."name" ${directionSql} NULLS LAST,
      u."login" ${directionSql},
      u."id" ${directionSql}
    `,
    [ADMIN_ACCESS_SORT_FIELDS.CREATED_AT]: Prisma.sql`
      ${adminAccessCreatedAtSortExpression(sortContext)} ${directionSql} NULLS LAST,
      u."id" ${directionSql}
    `,
    [ADMIN_ACCESS_SORT_FIELDS.LAST_LOGIN_AT]: Prisma.sql`
      (
        SELECT h."loginAt"
        FROM "LoginHistory" AS h
        WHERE h."userId" = u."id"
          AND h."event" = ${LoginHistoryEvent.LOGIN}::"LoginHistoryEvent"
          AND h."success" = TRUE
        ORDER BY h."loginAt" DESC, h."id" DESC
        LIMIT 1
      ) ${directionSql} NULLS LAST,
      u."id" ${directionSql}
    `,
    [ADMIN_ACCESS_SORT_FIELDS.ROLE]: Prisma.sql`
      CASE
        WHEN EXISTS (SELECT 1 FROM "Admin" a WHERE a."userId" = u."id") THEN 3
        WHEN (u."type" = 'STAFF' AND u."approvalStatus" = 'APPROVED' AND u."profileCreatedAt" IS NOT NULL AND u."name" IS NOT NULL AND u."department" IS NOT NULL) THEN 2
        WHEN u."type" = 'STUDENT'::"UserType" THEN 1
        ELSE 0
      END ${directionSql},
      u."id" ${directionSql}
    `,
    [ADMIN_ACCESS_SORT_FIELDS.ACCOUNT_STATUS]: Prisma.sql`
      CASE
        WHEN u."accountStatus" = ${AccountStatus.ACTIVE}::"AccountStatus" THEN 0
        WHEN u."accountStatus" = ${AccountStatus.DEACTIVATED}::"AccountStatus" THEN 1
        ELSE 2
      END ${directionSql},
      u."id" ${directionSql}
    `,
  } as const satisfies Readonly<Record<AdminAccessSortField, Prisma.Sql>>;
  return orderings[sort];
}

function adminAccessCreatedAtSortExpression(
  sortContext: AdminAccessListSortContext,
): Prisma.Sql {
  switch (sortContext) {
    case 'directory':
      return Prisma.sql`u."createdAt"`;
    case 'requestQueue':
      return Prisma.sql`u."approvalRequestedAt"`;
  }
}

function adminAccessSqlWhere(query: AdminAccessListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (query.query) {
    const contains = `%${query.query}%`;
    conditions.push(Prisma.sql`
      (
        u."name" ILIKE ${contains}
        OR u."login" ILIKE ${contains}
      )
    `);
  }
  if (query.role !== undefined) {
    conditions.push(adminAccessRoleFilterSql(query.role));
  }
  if (query.accountStatus !== undefined) {
    conditions.push(
      Prisma.sql`u."accountStatus" = ${query.accountStatus}::"AccountStatus"`,
    );
  }
  if (query.pendingRequest !== undefined) {
    conditions.push(
      query.pendingRequest === ADMIN_ACCESS_PENDING_FILTERS.PENDING
        ? Prisma.sql`
            (u."type" = 'STAFF' AND u."approvalStatus" = 'PENDING' AND u."approvalRequestId" IS NOT NULL)
          `
        : Prisma.sql`
            NOT (u."type" = 'STAFF' AND u."approvalStatus" = 'PENDING' AND u."approvalRequestId" IS NOT NULL)
          `,
    );
  }
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

function adminAccessRoleFilterSql(
  filter: NonNullable<AdminAccessListQuery['role']>,
): Prisma.Sql {
  switch (filter) {
    case ADMIN_ACCESS_ROLE_FILTERS.ADMIN:
      return Prisma.sql`EXISTS (SELECT 1 FROM "Admin" a WHERE a."userId" = u."id")`;
    case ADMIN_ACCESS_ROLE_FILTERS.STAFF:
      return Prisma.sql`((u."type" = 'STAFF' AND u."approvalStatus" = 'APPROVED' AND u."profileCreatedAt" IS NOT NULL AND u."name" IS NOT NULL AND u."department" IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM "Admin" a WHERE a."userId" = u."id"))`;
    case ADMIN_ACCESS_ROLE_FILTERS.STUDENT:
      return Prisma.sql`(
        NOT (u."type" = 'STAFF' AND u."approvalStatus" = 'APPROVED' AND u."profileCreatedAt" IS NOT NULL AND u."name" IS NOT NULL AND u."department" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "Admin" a WHERE a."userId" = u."id")
        AND u."type" = 'STUDENT'::"UserType"
      )`;
    case ADMIN_ACCESS_ROLE_FILTERS.UNASSIGNED:
      return Prisma.sql`(
        NOT (u."type" = 'STAFF' AND u."approvalStatus" = 'APPROVED' AND u."profileCreatedAt" IS NOT NULL AND u."name" IS NOT NULL AND u."department" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "Admin" a WHERE a."userId" = u."id")
        AND (u."type" IS NULL OR u."type" <> 'STUDENT'::"UserType")
      )`;
  }
}
