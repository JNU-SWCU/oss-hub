import { Prisma } from '@prisma/client';
import type { StaffAccessRequestStatus } from './user-contract.config';
import { APPROVAL_TRANSITION_EVENTS } from './user-history.config';
import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../platform/prisma.service';
import {
  type AdminAccessLoginHistoryPage,
  type AdminAccessStaffAccessRequestHistoryPage,
} from './admin-access-read-ordering.repository';

type HistoryPage = { readonly page: number; readonly limit: number };

interface RequestSnapshotRow {
  readonly id: string;
  readonly status: StaffAccessRequestStatus;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly decidedById: string | null;
  readonly rejectionReason: string | null;
}

@Injectable()
export class AdminAccessHistoryRepository {
  async listAdminAccessStaffAccessRequestHistory(
    prisma: Pick<PrismaService, '$queryRaw' | 'user'>,
    userId: string,
    page: HistoryPage,
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    const latest = latestRequestSnapshotsSql(userId);
    const [rows, counts] = await Promise.all([
      prisma.$queryRaw<RequestSnapshotRow[]>`
        WITH latest AS (${latest})
        SELECT
          request_id AS id,
          status,
          created_at AS "createdAt",
          decided_at AS "decidedAt",
          decided_by_id AS "decidedById",
          rejection_reason AS "rejectionReason"
        FROM latest
        ORDER BY created_at DESC, request_id COLLATE "C" DESC
        LIMIT ${page.limit} OFFSET ${(page.page - 1) * page.limit}
      `,
      prisma.$queryRaw<{ readonly total: number }[]>`
        WITH latest AS (${latest})
        SELECT COUNT(*)::int AS total FROM latest
        LIMIT 1
      `,
    ]);
    const selected = rows;
    const actorIds = selected.flatMap((request) =>
      request.decidedById === null ? [] : [request.decidedById],
    );
    const actors = await prisma.user.findMany({
      take: actorIds.length,
      where: { id: { in: actorIds } },
      select: { id: true, nickname: true },
    });
    const names = new Map(actors.map((actor) => [actor.id, actor.nickname]));
    return {
      items: selected.map((request) => ({
        id: request.id,
        status: request.status,
        rejectionReason: request.rejectionReason,
        decidedAt: request.decidedAt,
        decidedBy:
          request.decidedById === null
            ? null
            : (names.get(request.decidedById) ?? null),
        createdAt: request.createdAt,
      })),
      page: page.page,
      limit: page.limit,
      total: counts[0]?.total ?? 0,
    };
  }

  async listAdminAccessLoginHistory(
    prisma: Pick<PrismaService, 'loginHistory'>,
    userId: string,
    page: HistoryPage,
  ): Promise<AdminAccessLoginHistoryPage> {
    const where = { userId, provider: 'github' };
    const [logins, total] = await Promise.all([
      prisma.loginHistory.findMany({
        where,
        select: {
          id: true,
          event: true,
          success: true,
          loginAt: true,
        },
        orderBy: [{ loginAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
      prisma.loginHistory.count({ where }),
    ]);
    return {
      items: logins.map((login) => ({
        id: login.id,
        event: login.event,
        provider: 'github',
        success: login.success,
        loginAt: login.loginAt,
      })),
      page: page.page,
      limit: page.limit,
      total,
    };
  }
}

const LEGACY_LOCAL =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?$';

const ISO_DATE_TIME = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}';
const EARLIEST_REQUEST_TIME = '1970-01-01T00:00:00Z';
const LATEST_REQUEST_TIME = '10000-01-01T00:00:00Z';

function inSaneRange(text: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${text} ~ ${ISO_DATE_TIME}
    AND pg_input_is_valid(${text}, 'timestamptz')
    AND ${text}::timestamptz >= ${EARLIEST_REQUEST_TIME}::timestamptz
    AND ${text}::timestamptz < ${LATEST_REQUEST_TIME}::timestamptz
  )`;
}

function latestRequestSnapshotsSql(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      request_id,
      status,
      created_text::timestamptz AS created_at,
      decided_text::timestamptz AS decided_at,
      decided_by_id,
      rejection_reason
    FROM (
      SELECT DISTINCT ON (request->>'id')
        request->>'id' AS request_id,
        request->>'status' AS status,
        CASE
          WHEN legacy AND request->>'createdAt' ~ ${LEGACY_LOCAL}
            THEN request->>'createdAt' || 'Z'
          ELSE request->>'createdAt'
        END AS created_text,
        CASE
          WHEN jsonb_typeof(request->'decidedAt') = 'null' THEN NULL
          WHEN legacy AND request->>'decidedAt' ~ ${LEGACY_LOCAL}
            THEN request->>'decidedAt' || 'Z'
          ELSE request->>'decidedAt'
        END AS decided_text,
        request->>'decidedById' AS decided_by_id,
        request->>'rejectionReason' AS rejection_reason
      FROM (
        SELECT
          history.id,
          history."occurredAt",
          history."recordedAt",
          history.data->>'recordKind' = 'REQUEST_SNAPSHOT' AS legacy,
          CASE history.data->>'recordKind'
            WHEN 'REQUEST_SNAPSHOT' THEN history.data->'original'
            ELSE history.data->'request'
          END AS request
        FROM "UserHistory" AS history
        WHERE history."userId" = ${userId}
          AND history.data->'schemaVersion' = '1'::jsonb
          AND history.data->>'recordKind' IN
            ('REQUEST_SNAPSHOT', 'REQUEST_TRANSITION', 'DOMAIN_EVENT')
          AND (
            history.event::text = ANY(${[...APPROVAL_TRANSITION_EVENTS]}::text[])
            OR (
              history.event = 'LEGACY_IMPORT'
              AND history.data->>'recordKind' = 'REQUEST_SNAPSHOT'
            )
          )
      ) AS candidate
      WHERE jsonb_typeof(request) = 'object'
        AND jsonb_typeof(request->'id') = 'string'
        AND jsonb_typeof(request->'userId') = 'string'
        AND request->>'status' IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')
        AND jsonb_typeof(request->'createdAt') = 'string'
        AND jsonb_typeof(request->'decidedAt') IN ('null', 'string')
        AND jsonb_typeof(request->'decidedById') IN ('null', 'string')
        AND jsonb_typeof(request->'rejectionReason') IN ('null', 'string')
      ORDER BY request->>'id', "occurredAt" DESC, "recordedAt" DESC, id DESC
    ) AS latest
    WHERE ${inSaneRange(Prisma.sql`created_text`)}
      AND (decided_text IS NULL OR ${inSaneRange(Prisma.sql`decided_text`)})
  `;
}
