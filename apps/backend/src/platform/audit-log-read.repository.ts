import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface AuditLogListQuery {
  readonly actor?: string;
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page: number;
  readonly limit: number;
}

export type AuditLogRow = {
  readonly id: string;
  readonly occurredAt: Date;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata: unknown;
  readonly historyKind: string | null;
  readonly actor: { readonly nickname: string } | null;
  readonly joinedTarget: string | null;
};

type AuditLogQueryRow =
  | (AuditLogRow & { readonly total: number })
  | { readonly id: null; readonly total: number };

const AUDIT_HISTORY_FEED_CTE = `
    WITH histories AS (
      SELECT "id", "userId", "actorId", "event"::text, "occurredAt",
        "sourceTable", "sourceId", "sourcePart", "data"
      FROM "UserHistory"
      UNION ALL
      SELECT "id", "userId", "actorId", "event"::text, "occurredAt",
        "sourceTable", "sourceId", "sourcePart", "data"
      FROM "AdminHistory"
    ), imported AS (
      SELECT DISTINCT ON ("sourceId") "sourceId" AS "id", "actorId",
        "occurredAt", "data"->'original' AS "original"
      FROM histories
      WHERE "event" = 'LEGACY_IMPORT' AND "sourceTable" = 'AuditLog'
        AND "sourceId" IS NOT NULL
        AND "data"->>'schemaVersion' = '1'
        AND "data"->>'recordKind' = 'AUDIT_EVENT'
      ORDER BY "sourceId", "sourcePart", "id"
    ), events AS (
      SELECT "id", "actorId", "occurredAt",
        "original"->>'action' AS "action",
        "original"->>'targetType' AS "targetType",
        "original"->>'targetId' AS "targetId",
        "original"->'metadata' AS "metadata",
        NULL::text AS "historyKind",
        NULL::text AS "programId"
      FROM imported
      UNION ALL
      SELECT "id", "actorId", "occurredAt",
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->>'action'
          WHEN 'BOOTSTRAP' THEN CASE "event"
            WHEN 'GRANTED' THEN 'GRANT_ADMIN_ACCESS'
            WHEN 'REVOKED' THEN 'REVOKE_ADMIN_ACCESS'
            ELSE "event" END
          WHEN 'TYPE_SELECTION' THEN 'USER_ROLE_CHANGED'
          ELSE "event" END,
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->>'targetType'
          WHEN 'REQUEST_TRANSITION' THEN 'ROLE_REQUEST'
          ELSE 'USER' END,
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->>'targetId'
          WHEN 'REQUEST_TRANSITION' THEN "data"#>>'{request,id}'
          ELSE "userId" END,
        CASE "data"->>'recordKind'
          WHEN 'DOMAIN_EVENT' THEN "data"->'metadata'
          ELSE "data" END,
        CASE WHEN "data"->>'recordKind' = 'DOMAIN_EVENT' THEN NULL
          ELSE "data"->>'recordKind' END,
        NULL::text
      FROM histories
      WHERE "event" <> 'LEGACY_IMPORT'
        AND "data"->>'schemaVersion' = '1'
        AND "data"->>'recordKind' IN ('DOMAIN_EVENT', 'REQUEST_TRANSITION', 'SIGNUP', 'BOOTSTRAP', 'TYPE_SELECTION')
      UNION ALL
      SELECT history."id", history."actorId", history."occurredAt",
        COALESCE(history."data"->>'action', CASE history."event"::text
          WHEN 'CREATED' THEN 'TEAM_CREATED'
          WHEN 'JOINED' THEN 'TEAM_JOINED'
          WHEN 'RENAMED' THEN 'TEAM_RENAMED'
          WHEN 'DELETED' THEN 'TEAM_DELETED'
          WHEN 'MEMBER_LEFT' THEN 'TEAM_MEMBERSHIP_CHANGED'
          WHEN 'MEMBER_REMOVED' THEN 'TEAM_MEMBERSHIP_CHANGED'
          WHEN 'LEADER_TRANSFERRED' THEN 'TEAM_MEMBERSHIP_CHANGED'
          WHEN 'REPOSITORY_PUBLISHED' THEN 'REPOSITORY_PUBLISHED'
          ELSE 'APPLICATION_' || history."event"::text END),
        COALESCE(history."data"->>'targetType',
          CASE WHEN history."data"->>'applicationId' IS NOT NULL
            THEN 'APPLICATION' ELSE 'TEAM' END),
        COALESCE(history."data"->>'targetId', history."data"->>'applicationId',
          history."teamId"),
        COALESCE(history."data"->'metadata', history."data"->'pairedAuditMetadata',
          jsonb_strip_nulls(jsonb_build_object(
            'schemaVersion', 1,
            'programName', program."name",
            'teamName', COALESCE(history."data"->>'name', team."name"),
            'previousName', history."data"->>'previousName',
            'operation', CASE history."event"::text
              WHEN 'MEMBER_LEFT' THEN 'LEAVE'
              WHEN 'MEMBER_REMOVED' THEN 'REMOVE'
              WHEN 'LEADER_TRANSFERRED' THEN 'TRANSFER_LEADER' END,
            'removedUserId', history."data"->>'removedUserId',
            'previousLeaderId', history."data"->>'previousLeaderId'))
          || CASE WHEN history."data" ? 'nextLeaderId'
            THEN jsonb_build_object('nextLeaderId', history."data"->'nextLeaderId')
            ELSE '{}'::jsonb END),
        NULL::text,
        history."programId"
      FROM "TeamHistory" history
      LEFT JOIN "Program" program ON program."id" = history."programId"
      LEFT JOIN "Team" team ON team."id" = history."teamId"
      WHERE history."event"::text NOT LIKE 'INVITATION%'
      UNION ALL
      SELECT history."id", history."actorId", history."occurredAt",
        'PROGRAM_' || history."event"::text, 'PROGRAM', history."programId",
        history."data"->'metadata', NULL::text, history."programId"
      FROM "ProgramHistory" history
    )
`;

@Injectable()
export class AuditLogReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogListQuery): Promise<{
    readonly rows: readonly AuditLogRow[];
    readonly total: number;
  }> {
    const predicates: Prisma.Sql[] = [];
    if (query.actor)
      predicates.push(Prisma.sql`actor."login" ILIKE ${`%${query.actor}%`}`);
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
    const result = await this.prisma.$queryRaw<AuditLogQueryRow[]>`
      ${Prisma.raw(AUDIT_HISTORY_FEED_CTE)}, filtered AS (
        SELECT event."id", event."occurredAt", event."action", event."targetType",
          event."targetId", event."metadata", event."historyKind",
          CASE WHEN actor."id" IS NULL THEN NULL
            ELSE jsonb_build_object('nickname', actor."login") END AS "actor",
          CASE event."targetType"
            WHEN 'PROGRAM' THEN program."name"
            WHEN 'APPLICATION' THEN program."name"
            WHEN 'REPOSITORY' THEN repository."nameWithOwner" END AS "joinedTarget"
        FROM events event
        LEFT JOIN "User" actor ON actor."id" = event."actorId"
        LEFT JOIN "Program" program ON program."id" = event."programId"
        LEFT JOIN "GithubRepository" repository
          ON event."targetType" = 'REPOSITORY' AND repository."id" = event."targetId"
        ${where}
      )
      SELECT totals."total", page.*
      FROM (SELECT count(*)::integer AS "total" FROM filtered) totals
      LEFT JOIN LATERAL (
        SELECT * FROM filtered ORDER BY "occurredAt" DESC, "id" DESC
        OFFSET ${(query.page - 1) * query.limit} LIMIT ${query.limit}
      ) page ON true
      ORDER BY page."occurredAt" DESC, page."id" DESC
    `;
    return {
      rows: result.flatMap((row) => (row.id === null ? [] : [row])),
      total: result[0]?.total ?? 0,
    };
  }
}
