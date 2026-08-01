import { LoginHistoryEvent, Prisma, RoleRequestStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ACCESS_DEFAULT_DIRECTION,
  ADMIN_ACCESS_DEFAULT_SORT,
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  ADMIN_ACCESS_SORT_DIRECTIONS,
  ADMIN_ACCESS_SORT_FIELDS,
  type AdminAccessListQuery,
  type AdminAccessSortDirection,
  type AdminAccessSortField,
} from './domain/admin-access';

type OrderedAdminAccessUserId = { readonly id: string };

const ORDER_DIRECTIONS = {
  [ADMIN_ACCESS_SORT_DIRECTIONS.ASC]: Prisma.sql`ASC`,
  [ADMIN_ACCESS_SORT_DIRECTIONS.DESC]: Prisma.sql`DESC`,
} as const satisfies Readonly<Record<AdminAccessSortDirection, Prisma.Sql>>;

export function listOrderedAdminAccessUserIds(
  prisma: Pick<PrismaService, '$queryRaw'>,
  query: AdminAccessListQuery,
): Promise<readonly OrderedAdminAccessUserId[]> {
  const offset = (query.page - 1) * query.limit;
  const where = adminAccessSqlWhere(query);
  const orderBy = adminAccessOrderBy(query);
  return prisma.$queryRaw<readonly OrderedAdminAccessUserId[]>(Prisma.sql`
    SELECT u."id"
    FROM "User" AS u
    LEFT JOIN "UserProfile" AS p ON p."userId" = u."id"
    ${where}
    ORDER BY ${orderBy}
    LIMIT ${query.limit}
    OFFSET ${offset}
  `);
}

function adminAccessOrderBy(query: AdminAccessListQuery): Prisma.Sql {
  const sort = query.sort ?? ADMIN_ACCESS_DEFAULT_SORT;
  const direction = query.direction ?? ADMIN_ACCESS_DEFAULT_DIRECTION;
  const directionSql = ORDER_DIRECTIONS[direction];
  const orderings = {
    [ADMIN_ACCESS_SORT_FIELDS.NAME]: Prisma.sql`
      COALESCE(p."name", u."name") ${directionSql} NULLS LAST,
      u."login" ${directionSql},
      u."id" ${directionSql}
    `,
    [ADMIN_ACCESS_SORT_FIELDS.CREATED_AT]: Prisma.sql`
      u."createdAt" ${directionSql} NULLS LAST,
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
  } as const satisfies Readonly<Record<AdminAccessSortField, Prisma.Sql>>;
  return orderings[sort];
}

function adminAccessSqlWhere(query: AdminAccessListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (query.query) {
    const contains = `%${query.query}%`;
    conditions.push(Prisma.sql`
      (
        COALESCE(p."name", u."name") ILIKE ${contains}
        OR u."login" ILIKE ${contains}
      )
    `);
  }
  if (query.role !== undefined) {
    conditions.push(
      query.role === ADMIN_ACCESS_ROLE_FILTERS.UNASSIGNED
        ? Prisma.sql`u."role" IS NULL`
        : Prisma.sql`u."role" = ${query.role}::"Role"`,
    );
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
            EXISTS (
              SELECT 1
              FROM "RoleRequest" AS r
              WHERE r."userId" = u."id"
                AND r."status" = ${RoleRequestStatus.PENDING}::"RoleRequestStatus"
            )
          `
        : Prisma.sql`
            NOT EXISTS (
              SELECT 1
              FROM "RoleRequest" AS r
              WHERE r."userId" = u."id"
                AND r."status" = ${RoleRequestStatus.PENDING}::"RoleRequestStatus"
            )
          `,
    );
  }
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}
