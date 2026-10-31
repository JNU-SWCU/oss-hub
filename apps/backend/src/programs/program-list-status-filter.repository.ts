import { Prisma, ProgramLifecycle } from '@prisma/client';
import {
  PROGRAM_LIST_QUERY_STATUSES,
  PROGRAM_LIST_QUERY_SORTS,
  PROGRAM_LIST_QUERY_DIRECTIONS,
} from './program-list.config';

export type ProgramListQueryStatus =
  (typeof PROGRAM_LIST_QUERY_STATUSES)[number];

export type ProgramListQuerySort = (typeof PROGRAM_LIST_QUERY_SORTS)[number];

export type ProgramListQueryDirection =
  (typeof PROGRAM_LIST_QUERY_DIRECTIONS)[number];

export interface ProgramListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListQueryStatus;
  readonly year?: number;

  readonly sort?: ProgramListQuerySort;

  readonly direction?: ProgramListQueryDirection;
}

export type ProgramListDerivedStatus = Exclude<
  ProgramListQueryStatus,
  'all' | 'current'
>;

export type ProgramListStatusInput = {
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date;
};

export class ProgramListStatusFilterRepository {
  static deriveProgramListStatus(
    program: ProgramListStatusInput,
    now: Date,
  ): ProgramListDerivedStatus {
    if (program.lifecycle === ProgramLifecycle.ARCHIVED) return 'ended';
    if (program.endAt < now) return 'ended';
    if (program.applicationStartAt > now) return 'upcoming';
    if (program.applicationEndAt >= now) return 'recruiting';
    return 'in_progress';
  }

  static programListSortRank(status: ProgramListDerivedStatus): 0 | 1 | 2 | 3 {
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

  static programListPrismaWhere(
    status: ProgramListQueryStatus,
    now: Date,
  ): Prisma.ProgramWhereInput {
    const whereByStatus = {
      current: {
        lifecycle: ProgramLifecycle.PUBLISHED,
        ...notDateEnded(now),
      },
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

  static programListSqlStatusPredicate(
    status: ProgramListQueryStatus,
    now: Date,
  ): Prisma.Sql {
    if (status === 'all') {
      return Prisma.sql`p."lifecycle" IN ('PUBLISHED', 'ARCHIVED')`;
    }
    if (status === 'current') {
      return Prisma.sql`p."lifecycle" = 'PUBLISHED' AND p."endAt" >= ${now}`;
    }
    return Prisma.sql`(${programListStatusCaseSql(now)}) = ${status}`;
  }

  static programEndYearRange(year: number) {
    return {
      gte: new Date(Date.UTC(year, 0, 1, -9)),
      lt: new Date(Date.UTC(year + 1, 0, 1, -9)),
    };
  }

  static programListSortRankSql(now: Date): Prisma.Sql {
    return Prisma.sql`
    CASE (${programListStatusCaseSql(now)})
      WHEN 'recruiting' THEN 0
      WHEN 'upcoming' THEN 1
      WHEN 'in_progress' THEN 2
      WHEN 'ended' THEN 3
    END
  `;
  }

  static programListStatusSortRank(
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

  static programListOrderBySql(
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
        ${ProgramListStatusFilterRepository.programListSortRankSql(now)} ASC,
        p."applicationEndAt" ASC,
        p."name" ASC,
        p."id" ASC
      `;
    }
  }

  static programListSqlWhere(
    status: ProgramListQueryStatus,
    search: string,
    now: Date,
    year?: number,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      ProgramListStatusFilterRepository.programListSqlStatusPredicate(
        status,
        now,
      ),
    ];
    if (year !== undefined) {
      const { gte, lt } =
        ProgramListStatusFilterRepository.programEndYearRange(year);
      conditions.push(Prisma.sql`p."endAt" >= ${gte} AND p."endAt" < ${lt}`);
    }
    if (search) {
      conditions.push(Prisma.sql`p."name" ILIKE ${`%${search}%`}`);
    }
    return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  }

  static programStatusCountsSql(now: Date): Prisma.Sql {
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
}

const notDateEnded = (now: Date): Prisma.ProgramWhereInput => ({
  endAt: { gte: now },
});

function programListStatusCaseSql(now: Date): Prisma.Sql {
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

function programListStatusSortRankSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE (${programListStatusCaseSql(now)})
      WHEN 'recruiting' THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'upcoming' THEN 2
      WHEN 'ended' THEN 3
    END
  `;
}
