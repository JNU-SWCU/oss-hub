import { Prisma, ProgramLifecycle } from '@prisma/client';
import type { ProgramListQueryStatus } from './program-list-query';

/**
 * 공개 목록 기간 필터 — 저장 상태 없음, 요청 시각(now)으로만 해석.
 * Prisma where · raw SQL WHERE · status-counts · ORDER BY 정렬 가중치의 **단일 원본**.
 *
 * 공개 모수(universe) = PUBLISHED | ARCHIVED
 * 배타 우선순위 (첫 매치 승, CASE와 동일):
 *   1. ARCHIVED                         → ended
 *   2. endAt 있음 && endAt < now        → ended
 *   3. applicationStartAt > now         → upcoming
 *   4. applicationEndAt >= now          → recruiting
 *   5. 그 외                            → in_progress
 *
 * all = universe 전체. 나머지 넷은 위 파티션이라 all === sum(parts).
 * `?status=` 키는 URL 필터 라벨이지 DB 컬럼이 아니다.
 */

export type ProgramListDerivedStatus = Exclude<ProgramListQueryStatus, 'all'>;

export type ProgramListStatusInput = {
  readonly lifecycle: ProgramLifecycle;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly endAt: Date | null;
};

/** 기간 해석 순수 함수 — SQL CASE / Prisma where 와 동일 우선순위. 저장하지 않는다. */
export function deriveProgramListStatus(
  program: ProgramListStatusInput,
  now: Date,
): ProgramListDerivedStatus {
  if (program.lifecycle === ProgramLifecycle.ARCHIVED) return 'ended';
  if (program.endAt !== null && program.endAt < now) return 'ended';
  if (program.applicationStartAt > now) return 'upcoming';
  if (program.applicationEndAt >= now) return 'recruiting';
  return 'in_progress';
}

/** 목록 정렬 표시 순서 — 판정 우선순위와 별개 (모집중 → 접수대기 → 진행중 → 종료). */
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
  OR: [{ endAt: null }, { endAt: { gte: now } }],
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
          endAt: { not: null, lt: now },
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

/** 공유 CASE 식 — 필터·집계·정렬이 전부 이것을 쓴다. */
export function programListStatusCaseSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN p."lifecycle" = 'ARCHIVED' THEN 'ended'
      WHEN p."endAt" IS NOT NULL AND p."endAt" < ${now} THEN 'ended'
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

/** recruiting → 0 … ended → 3. 표시 정렬 순서 (§3.2). */
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

export type ProgramStatusCounts = {
  readonly all: number;
  readonly recruiting: number;
  readonly in_progress: number;
  readonly upcoming: number;
  readonly ended: number;
};

/**
 * universe 한 번 읽고 CASE로 파티션 집계.
 * all = COUNT(*) 이므로 부분 합과 항상 같다.
 */
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

export function emptyProgramStatusCounts(): ProgramStatusCounts {
  return {
    all: 0,
    recruiting: 0,
    in_progress: 0,
    upcoming: 0,
    ended: 0,
  };
}
