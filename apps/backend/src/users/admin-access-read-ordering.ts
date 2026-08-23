import {
  AccountStatus,
  LoginHistoryEvent,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  STAFF_ACCESS_REQUEST_STATUS_TYPE,
  STAFF_ACCESS_REQUEST_TABLE,
} from '../roles/staff-access-request-physical-names';
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
      p."name" ${directionSql} NULLS LAST,
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
    [ADMIN_ACCESS_SORT_FIELDS.ROLE]: Prisma.sql`
      CASE
        WHEN u."hasAdminAccess" THEN 3
        WHEN u."hasStaffAccess" THEN 2
        WHEN p."memberKind" = 'STUDENT'::"MemberKind" THEN 1
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

function adminAccessSqlWhere(query: AdminAccessListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (query.query) {
    const contains = `%${query.query}%`;
    conditions.push(Prisma.sql`
      (
        p."name" ILIKE ${contains}
        OR u."login" ILIKE ${contains}
      )
    `);
  }
  if (query.role !== undefined) {
    // 표시 역할은 canonical 세 사실의 접힌 요약이다(`domain/authority-label.ts`).
    // 필터도 같은 우선순위(관리자 → 교직원 → 학생)로 되짚어야 목록과 어긋나지 않는다.
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
            EXISTS (
              SELECT 1
              FROM ${STAFF_ACCESS_REQUEST_TABLE} AS r
              WHERE r."userId" = u."id"
                AND r."status" = ${StaffAccessRequestStatus.PENDING}::${STAFF_ACCESS_REQUEST_STATUS_TYPE}
            )
          `
        : Prisma.sql`
            NOT EXISTS (
              SELECT 1
              FROM ${STAFF_ACCESS_REQUEST_TABLE} AS r
              WHERE r."userId" = u."id"
                AND r."status" = ${StaffAccessRequestStatus.PENDING}::${STAFF_ACCESS_REQUEST_STATUS_TYPE}
            )
          `,
    );
  }
  return conditions.length === 0
    ? Prisma.empty
    : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/** 표시 역할 필터를 canonical 컬럼 조건으로 되짚는다. `authorityLabel`과 같은 우선순위다. */
function adminAccessRoleFilterSql(
  filter: NonNullable<AdminAccessListQuery['role']>,
): Prisma.Sql {
  switch (filter) {
    case ADMIN_ACCESS_ROLE_FILTERS.ADMIN:
      return Prisma.sql`u."hasAdminAccess"`;
    case ADMIN_ACCESS_ROLE_FILTERS.STAFF:
      return Prisma.sql`(u."hasStaffAccess" AND NOT u."hasAdminAccess")`;
    case ADMIN_ACCESS_ROLE_FILTERS.STUDENT:
      return Prisma.sql`(
        NOT u."hasStaffAccess"
        AND NOT u."hasAdminAccess"
        AND p."memberKind" = 'STUDENT'::"MemberKind"
      )`;
    case ADMIN_ACCESS_ROLE_FILTERS.UNASSIGNED:
      return Prisma.sql`(
        NOT u."hasStaffAccess"
        AND NOT u."hasAdminAccess"
        AND (p."memberKind" IS NULL OR p."memberKind" <> 'STUDENT'::"MemberKind")
      )`;
  }
}
