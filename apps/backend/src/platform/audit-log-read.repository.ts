import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  AUDIT_SOURCE_QUERIES,
  type AuditCategory,
} from './audit-source.config';
import type { AuditCategoryCounts, AuditSourceRow } from './audit-entry.types';

export interface AuditLogListQuery {
  readonly q?: string;
  readonly action?: string;
  readonly category?: AuditCategory;
  readonly from?: string;
  readonly to?: string;
  readonly page: number;
  readonly limit: number;
}

type AuditLogTotals = {
  readonly total: number;
  readonly accountCount: number;
  readonly operationCount: number;
  readonly submissionCount: number;
  readonly loginCount: number;
  readonly systemCount: number;
};

type AuditLogQueryRow =
  (AuditSourceRow & AuditLogTotals) | (AuditLogTotals & { readonly id: null });

const AUDIT_FEED_EVENTS = Object.values(AUDIT_SOURCE_QUERIES)
  .map((query) => `(${query})`)
  .join('\n    UNION ALL\n');

const STORED_SNAPSHOT = `(event."historyKind" IS NULL
  AND jsonb_typeof(event."metadata") = 'object'
  AND NOT event."metadata" ? 'recordKind'
  AND event."metadata"->'schemaVersion' IN ('1'::jsonb, '2'::jsonb)
  AND NOT (event."action" = 'USER_PHONE_UPDATED'
    AND COALESCE(event."metadata"->>'transition', '') NOT IN ('SET', 'REPLACED')))`;

const snapshotPerson = (key: 'actor' | 'target') => `(${STORED_SNAPSHOT}
  AND jsonb_typeof(event."metadata"#>'{${key},githubLogin}') = 'string'
  AND event."metadata"#>>'{${key},githubLogin}' <> ''
  AND jsonb_typeof(event."metadata"#>'{${key},displayName}') IN ('string', 'null'))`;

const snapshotName = (key: 'actor' | 'target') =>
  `CASE WHEN ${snapshotPerson(key)}
    THEN NULLIF(btrim(event."metadata"#>>'{${key},displayName}'), '') END`;

const snapshotLogin = (key: 'actor' | 'target') =>
  `CASE WHEN ${snapshotPerson(key)}
    THEN event."metadata"#>>'{${key},githubLogin}' END`;

const joinedRole = (alias: string, adminAlias: string) =>
  `CASE WHEN ${alias}."id" IS NULL THEN NULL
    WHEN ${adminAlias}."userId" IS NULL THEN ${alias}."type"::text
    ELSE 'ADMIN' END`;

const APPLICANT_SNAPSHOT_LOGIN = `CASE WHEN ${STORED_SNAPSHOT}
  THEN NULLIF(event."metadata"->>'applicantGithubLogin', '') END`;

const AUDIT_FEED_RESOLVED_SELECT = `
  SELECT event."id", event."source", event."occurredAt", event."action",
    event."targetType", event."targetId", event."metadata", event."historyKind",
    event."requestId",
    CASE WHEN event."actorId" IS NULL THEN 'SYSTEM'
      ELSE event."category" END AS "category",
    CASE WHEN actor."id" IS NULL AND NOT ${snapshotPerson('actor')} THEN NULL
      ELSE jsonb_build_object(
        'id', actor."id",
        'name', COALESCE(${snapshotName('actor')}, NULLIF(btrim(actor."name"), '')),
        'login', COALESCE(${snapshotLogin('actor')}, actor."login"),
        'role', ${joinedRole('actor', 'actor_admin')}) END AS "actor",
    CASE
      WHEN event."targetType" IN ('USER', 'ROLE_REQUEST') THEN
        CASE WHEN subject."id" IS NULL AND NOT ${snapshotPerson('target')} THEN NULL
          ELSE jsonb_build_object(
            'name', COALESCE(${snapshotName('target')}, NULLIF(btrim(subject."name"), '')),
            'login', COALESCE(${snapshotLogin('target')}, subject."login"),
            'role', ${joinedRole('subject', 'subject_admin')}) END
      WHEN event."targetType" = 'APPLICATION'
        AND COALESCE(${snapshotLogin('target')}, ${APPLICANT_SNAPSHOT_LOGIN}) IS NOT NULL
        THEN jsonb_build_object(
          'name', ${snapshotName('target')},
          'login', COALESCE(${snapshotLogin('target')}, ${APPLICANT_SNAPSHOT_LOGIN}),
          'role', NULL)
    END AS "targetPerson",
    program."name" AS "programName",
    team."name" AS "teamName",
    repo."owner_name" AS "repositoryName"
  FROM events event
  LEFT JOIN "User" actor ON actor."id" = event."actorId"
  LEFT JOIN "Admin" actor_admin ON actor_admin."userId" = actor."id"
  LEFT JOIN "User" subject ON subject."id" = event."subjectUserId"
  LEFT JOIN "Admin" subject_admin ON subject_admin."userId" = subject."id"
  LEFT JOIN "Program" program ON program."id" = event."programId"
  LEFT JOIN "Team" team ON team."id" = event."teamId"
  LEFT JOIN "repo" repo
    ON event."targetType" = 'REPOSITORY'
    AND repo."github_repo_id"::text = event."targetId"
`;

@Injectable()
export class AuditLogReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogListQuery): Promise<{
    readonly rows: readonly AuditSourceRow[];
    readonly total: number;
    readonly counts: AuditCategoryCounts;
  }> {
    const predicates: Prisma.Sql[] = [];
    if (query.q) {
      const pattern = `%${query.q}%`;
      predicates.push(
        Prisma.sql`(event."actor"->>'name' ILIKE ${pattern}
          OR event."actor"->>'login' ILIKE ${pattern}
          OR event."targetPerson"->>'name' ILIKE ${pattern}
          OR event."targetPerson"->>'login' ILIKE ${pattern})`,
      );
    }
    if (query.action)
      predicates.push(Prisma.sql`event."action" = ${query.action}`);
    if (query.from)
      predicates.push(
        Prisma.sql`event."occurredAt" >= ${new Date(`${query.from}T00:00:00.000+09:00`)}`,
      );
    if (query.to)
      predicates.push(
        Prisma.sql`event."occurredAt" <= ${new Date(`${query.to}T23:59:59.999+09:00`)}`,
      );
    const where = predicates.length
      ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
      : Prisma.empty;
    const inCategory = query.category
      ? Prisma.sql`"category" = ${query.category}`
      : Prisma.sql`true`;
    const result = await this.prisma.$queryRaw<AuditLogQueryRow[]>`
      WITH events AS (${Prisma.raw(AUDIT_FEED_EVENTS)}),
      resolved AS (${Prisma.raw(AUDIT_FEED_RESOLVED_SELECT)}),
      filtered AS (SELECT * FROM resolved event ${where})
      SELECT totals.*, page.*
      FROM (
        SELECT count(*) FILTER (WHERE ${inCategory})::integer AS "total",
          count(*) FILTER (WHERE "category" = 'ACCOUNT')::integer AS "accountCount",
          count(*) FILTER (WHERE "category" = 'OPERATION')::integer AS "operationCount",
          count(*) FILTER (WHERE "category" = 'SUBMISSION')::integer AS "submissionCount",
          count(*) FILTER (WHERE "category" = 'LOGIN')::integer AS "loginCount",
          count(*) FILTER (WHERE "category" = 'SYSTEM')::integer AS "systemCount"
        FROM filtered
      ) totals
      LEFT JOIN LATERAL (
        SELECT * FROM filtered WHERE ${inCategory}
        ORDER BY "occurredAt" DESC, "id" DESC
        OFFSET ${(query.page - 1) * query.limit} LIMIT ${query.limit}
      ) page ON true
      ORDER BY page."occurredAt" DESC, page."id" DESC
      LIMIT ${query.limit}
    `;
    const totals = result[0];
    return {
      rows: result.flatMap((row) => (row.id === null ? [] : [row])),
      total: totals?.total ?? 0,
      counts: {
        ACCOUNT: totals?.accountCount ?? 0,
        OPERATION: totals?.operationCount ?? 0,
        SUBMISSION: totals?.submissionCount ?? 0,
        LOGIN: totals?.loginCount ?? 0,
        SYSTEM: totals?.systemCount ?? 0,
      },
    };
  }
}
