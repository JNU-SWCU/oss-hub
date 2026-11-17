import { Prisma } from '@prisma/client';
import type { StaffAccessRequestStatus } from './user-contract.config';
import type { RequestSnapshot } from './user-history.types';
import { APPROVAL_TRANSITION_EVENTS } from './user-history.config';
import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../platform/prisma.service';
import {
  type AdminAccessLoginHistoryPage,
  type AdminAccessStaffAccessRequestHistoryPage,
} from './admin-access-read-ordering.repository';

type HistoryPage = { readonly page: number; readonly limit: number };

@Injectable()
export class AdminAccessHistoryRepository {
  async listAdminAccessStaffAccessRequestHistory(
    prisma: Pick<PrismaService, '$queryRaw' | 'user'>,
    userId: string,
    page: HistoryPage,
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    const latest = latestRequestSnapshotsSql(userId);
    const [rows, counts] = await Promise.all([
      prisma.$queryRaw<{ readonly data: Prisma.JsonValue }[]>`
        WITH latest AS (${latest})
        SELECT data FROM latest
        ORDER BY created_at DESC, request_id COLLATE "C" DESC
        LIMIT ${page.limit} OFFSET ${(page.page - 1) * page.limit}
      `,
      prisma.$queryRaw<{ readonly total: number }[]>`
        WITH latest AS (${latest})
        SELECT COUNT(*)::int AS total FROM latest
        LIMIT 1
      `,
    ]);
    const selected = rows.flatMap((row) => {
      const request = readRequestSnapshot(row.data);
      return request === null ? [] : [request];
    });
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
        decidedAt:
          request.decidedAt === null ? null : new Date(request.decidedAt),
        decidedBy:
          request.decidedById === null
            ? null
            : (names.get(request.decidedById) ?? null),
        createdAt: new Date(request.createdAt),
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

const ISO_PREFIX = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}';
const LEGACY_LOCAL =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?$';

function latestRequestSnapshotsSql(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON (request->>'id')
      request->>'id' AS request_id,
      data,
      CASE
        WHEN legacy AND request->>'createdAt' ~ ${LEGACY_LOCAL}
          THEN (request->>'createdAt' || 'Z')::timestamptz
        ELSE (request->>'createdAt')::timestamptz
      END AS created_at
    FROM (
      SELECT
        history.id,
        history."occurredAt",
        history."recordedAt",
        history.data,
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
      AND request->>'createdAt' ~ ${ISO_PREFIX}
      AND (
        jsonb_typeof(request->'decidedAt') = 'null'
        OR (
          jsonb_typeof(request->'decidedAt') = 'string'
          AND request->>'decidedAt' ~ ${ISO_PREFIX}
        )
      )
      AND jsonb_typeof(request->'decidedById') IN ('null', 'string')
      AND jsonb_typeof(request->'rejectionReason') IN ('null', 'string')
    ORDER BY request->>'id', "occurredAt" DESC, "recordedAt" DESC, id DESC
  `;
}

function readRequestSnapshot(data: Prisma.JsonValue): RequestSnapshot | null {
  if (!isObject(data) || data.schemaVersion !== 1) return null;
  let request: Prisma.JsonValue | undefined;
  switch (data.recordKind) {
    case 'REQUEST_SNAPSHOT':
      request = data.original;
      break;
    case 'REQUEST_TRANSITION':
    case 'DOMAIN_EVENT':
      request = data.request;
      break;
    default:
      return null;
  }
  if (!isObject(request)) return null;
  const { id, userId, status, decidedById, rejectionReason } = request;
  const legacy = data.recordKind === 'REQUEST_SNAPSHOT';
  const createdAt = parseRequestTimestamp(request.createdAt, legacy);
  const decidedAt =
    request.decidedAt === null
      ? null
      : parseRequestTimestamp(request.decidedAt, legacy);
  if (
    typeof id !== 'string' ||
    typeof userId !== 'string' ||
    !isRequestStatus(status) ||
    createdAt === null ||
    (request.decidedAt !== null && decidedAt === null) ||
    !(decidedById === null || typeof decidedById === 'string') ||
    !(rejectionReason === null || typeof rejectionReason === 'string')
  ) {
    return null;
  }
  return {
    id,
    userId,
    status,
    createdAt,
    decidedAt,
    decidedById,
    rejectionReason,
  };
}

function isObject(
  value: Prisma.JsonValue | undefined,
): value is Prisma.JsonObject {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function parseRequestTimestamp(
  value: Prisma.JsonValue | undefined,
  legacy: boolean,
): string | null {
  if (typeof value !== 'string') return null;
  const timestamp =
    legacy && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
      ? `${value}Z`
      : value;
  const instant = new Date(timestamp);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

function isRequestStatus(
  value: Prisma.JsonValue | undefined,
): value is StaffAccessRequestStatus {
  switch (value) {
    case 'PENDING':
    case 'APPROVED':
    case 'REJECTED':
    case 'REVOKED':
      return true;
    default:
      return false;
  }
}
