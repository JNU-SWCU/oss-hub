import type { Prisma } from '@prisma/client';
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
    prisma: Pick<PrismaService, 'userHistory' | 'user'>,
    userId: string,
    page: HistoryPage,
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    const histories = await prisma.userHistory.findMany({
      where: { userId },
      select: { event: true, data: true },
      orderBy: [{ occurredAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
    });
    const byRequest = new Map<string, RequestSnapshot>();
    for (const history of histories) {
      const importedRequest =
        history.event === 'LEGACY_IMPORT' &&
        isObject(history.data) &&
        history.data.recordKind === 'REQUEST_SNAPSHOT';
      if (
        !importedRequest &&
        !APPROVAL_TRANSITION_EVENTS.includes(history.event)
      ) {
        continue;
      }
      const request = readRequestSnapshot(history.data);
      if (request !== null) byRequest.set(request.id, request);
    }
    const requests = [...byRequest.values()].sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
    const selected = requests.slice(
      (page.page - 1) * page.limit,
      page.page * page.limit,
    );
    const actorIds = selected.flatMap((request) =>
      request.decidedById === null ? [] : [request.decidedById],
    );
    const actors = await prisma.user.findMany({
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
      total: requests.length,
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
