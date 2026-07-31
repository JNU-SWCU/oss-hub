import { Prisma, RoleRequestStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_ACCESS_PENDING_FILTERS,
  ADMIN_ACCESS_ROLE_FILTERS,
  type AdminAccessListQuery,
} from './domain/admin-access';

type OrderedAdminAccessUserId = { readonly id: string };

export function listOrderedAdminAccessUserIds(
  prisma: Pick<PrismaService, '$queryRaw'>,
  query: AdminAccessListQuery,
): Promise<readonly OrderedAdminAccessUserId[]> {
  const offset = (query.page - 1) * query.limit;
  const where = adminAccessSqlWhere(query);
  return prisma.$queryRaw<readonly OrderedAdminAccessUserId[]>(Prisma.sql`
    SELECT u."id"
    FROM "User" AS u
    LEFT JOIN "UserProfile" AS p ON p."userId" = u."id"
    ${where}
    ORDER BY
      COALESCE(p."name", u."name") ASC,
      u."login" ASC,
      u."id" ASC
    LIMIT ${query.limit}
    OFFSET ${offset}
  `);
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
