import { Prisma, ProgramLifecycle } from '@prisma/client';
import type {
  ProgramListQueryDirection,
  ProgramListQuerySort,
  ProgramListQueryStatus,
} from './program-list-query';

export type ProgramListDerivedStatus = Exclude<ProgramListQueryStatus, 'all'>;

export type ProgramListStatusInput = {
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date;
};

export function deriveProgramListStatus(
  program: ProgramListStatusInput,
  now: Date,
): ProgramListDerivedStatus {
  if (program.lifecycle === ProgramLifecycle.ARCHIVED) return 'ended';
  if (program.endAt < now) return 'ended';
  if (program.applicationStartAt > now) return 'upcoming';
  if (program.applicationEndAt >= now) return 'recruiting';
  return 'in_progress';
}

export function programListSortRank(
  status: ProgramListDerivedStatus,
): 0 | 1 | 2 | 3 {
  switch (status) {
    case 'recruiting':
      return 0;
    case 'upcoming':
      return 1;
    case 'in_progress':
      return 2;
    case 'ended':
      return 3;
  }
}

const notDateEnded = (now: Date): Prisma.ProgramWhereInput => ({
  endAt: { gte: now },
});

export function programListPrismaWhere(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.ProgramWhereInput {
  const whereByStatus = {
    all: {
      lifecycle: {
        in: [ProgramLifecycle.PUBLISHED, ProgramLifecycle.ARCHIVED],
      },
    },
    ended: {
      OR: [
        { lifecycle: ProgramLifecycle.ARCHIVED },
        {
          lifecycle: ProgramLifecycle.PUBLISHED,
          endAt: { lt: now },
        },
      ],
    },
    upcoming: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { gt: now },
      ...notDateEnded(now),
    },
    recruiting: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
      ...notDateEnded(now),
    },
    in_progress: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { lt: now },
      ...notDateEnded(now),
    },
  } satisfies Readonly<
    Record<ProgramListQueryStatus, Prisma.ProgramWhereInput>
  >;
  return whereByStatus[status];
}

export function programListStatusCaseSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN p."lifecycle" = 'ARCHIVED' THEN 'ended'
      WHEN p."endAt" < ${now} THEN 'ended'
      WHEN p."applicationStartAt" > ${now} THEN 'upcoming'
      WHEN p."applicationEndAt" >= ${now} THEN 'recruiting'
      ELSE 'in_progress'
    END
  `;
}

export function programListSqlStatusPredicate(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.Sql {
  if (status === 'all') {
    return Prisma.sql`p."lifecycle" IN ('PUBLISHED', 'ARCHIVED')`;
  }
  return Prisma.sql`(${programListStatusCaseSql(now)}) = ${status}`;
}

export function programListSortRankSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE (${programListStatusCaseSql(now)})
      WHEN 'recruiting' THEN 0
      WHEN 'upcoming' THEN 1
      WHEN 'in_progress' THEN 2
      WHEN 'ended' THEN 3
    END
  `;
}

export function programListStatusSortRank(
  status: ProgramListDerivedStatus,
): 0 | 1 | 2 | 3 {
  switch (status) {
    case 'recruiting':
      return 0;
    case 'in_progress':
      return 1;
    case 'upcoming':
      return 2;
    case 'ended':
      return 3;
  }
}

export function programListStatusSortRankSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE (${programListStatusCaseSql(now)})
      WHEN 'recruiting' THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'upcoming' THEN 2
      WHEN 'ended' THEN 3
    END
  `;
}

export function programListOrderBySql(
  sort: ProgramListQuerySort | undefined,
  direction: ProgramListQueryDirection | undefined,
  now: Date,
): Prisma.Sql {
  const dir = direction === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  switch (sort) {
    case 'name':
      return Prisma.sql`p."name" ${dir}, p."id" ASC`;
    case 'applicationPeriod':
      return Prisma.sql`p."applicationStartAt" ${dir}, p."id" ASC`;
    case 'status':
      return Prisma.sql`
        ${programListStatusSortRankSql(now)} ${dir},
        p."applicationEndAt" ASC,
        p."name" ASC,
        p."id" ASC
      `;
    default:
      return Prisma.sql`
        ${programListSortRankSql(now)} ASC,
        p."applicationEndAt" ASC,
        p."name" ASC,
        p."id" ASC
      `;
  }
}

export function programListSqlWhere(
  status: ProgramListQueryStatus,
  search: string,
  now: Date,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [programListSqlStatusPredicate(status, now)];
  if (search) {
    conditions.push(Prisma.sql`p."name" ILIKE ${`%${search}%`}`);
  }
  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

export function programStatusCountsSql(now: Date): Prisma.Sql {
  const statusCase = programListStatusCaseSql(now);
  return Prisma.sql`
    SELECT
      COUNT(*)::int AS "all",
      COUNT(*) FILTER (WHERE (${statusCase}) = 'recruiting')::int AS recruiting,
      COUNT(*) FILTER (WHERE (${statusCase}) = 'in_progress')::int AS in_progress,
      COUNT(*) FILTER (WHERE (${statusCase}) = 'upcoming')::int AS upcoming,
      COUNT(*) FILTER (WHERE (${statusCase}) = 'ended')::int AS ended
    FROM "Program" AS p
    WHERE p."lifecycle" IN ('PUBLISHED', 'ARCHIVED')
  `;
}
