import { Prisma, ProgramLifecycle } from '@prisma/client';
import type { ProgramListQueryStatus } from './program-list-query';

/**
 * 공개 목록 상태 필터 — 상호 배타 (연습대회 없음).
 * Prisma where · raw SQL WHERE · status-counts 집계의 **단일 원본**.
 *
 * - all: PUBLISHED 전체
 * - upcoming: 접수 시작 전
 * - recruiting: 접수 기간 중
 * - in_progress: 접수 종료 후 · 프로그램 종료 전(또는 endAt 없음)
 * - ended: endAt 경과 또는 ARCHIVED
 */
export function programListPrismaWhere(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.ProgramWhereInput {
  const whereByStatus = {
    all: { lifecycle: ProgramLifecycle.PUBLISHED },
    upcoming: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { gt: now },
    },
    recruiting: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
    },
    in_progress: {
      lifecycle: ProgramLifecycle.PUBLISHED,
      applicationEndAt: { lt: now },
      OR: [{ endAt: null }, { endAt: { gte: now } }],
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
  } satisfies Readonly<
    Record<ProgramListQueryStatus, Prisma.ProgramWhereInput>
  >;
  return whereByStatus[status];
}

/** 목록 raw SQL WHERE 의 status 절 — `programListPrismaWhere` 와 동일 규칙. */
export function programListSqlStatusPredicate(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.Sql {
  switch (status) {
    case 'ended':
      return Prisma.sql`(p."lifecycle" = 'ARCHIVED' OR (p."lifecycle" = 'PUBLISHED' AND p."endAt" IS NOT NULL AND p."endAt" < ${now}))`;
    case 'upcoming':
      return Prisma.sql`p."lifecycle" = 'PUBLISHED' AND p."applicationStartAt" > ${now}`;
    case 'recruiting':
      return Prisma.sql`p."lifecycle" = 'PUBLISHED' AND p."applicationStartAt" <= ${now} AND p."applicationEndAt" >= ${now}`;
    case 'in_progress':
      return Prisma.sql`p."lifecycle" = 'PUBLISHED' AND p."applicationEndAt" < ${now} AND (p."endAt" IS NULL OR p."endAt" >= ${now})`;
    case 'all':
      return Prisma.sql`p."lifecycle" = 'PUBLISHED'`;
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

export type ProgramStatusCounts = {
  readonly all: number;
  readonly recruiting: number;
  readonly in_progress: number;
  readonly upcoming: number;
  readonly ended: number;
};

/**
 * 상태별 카운트 — 각 키의 FILTER 식은 `programListSqlStatusPredicate` 와 동일.
 * `all` 은 상호 배타 파티션이 아니라 PUBLISHED 전체이므로 FILTER 5키 한 방.
 */
export function programStatusCountsSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE ${programListSqlStatusPredicate('all', now)})::int AS "all",
      COUNT(*) FILTER (WHERE ${programListSqlStatusPredicate('recruiting', now)})::int AS recruiting,
      COUNT(*) FILTER (WHERE ${programListSqlStatusPredicate('in_progress', now)})::int AS in_progress,
      COUNT(*) FILTER (WHERE ${programListSqlStatusPredicate('upcoming', now)})::int AS upcoming,
      COUNT(*) FILTER (WHERE ${programListSqlStatusPredicate('ended', now)})::int AS ended
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
