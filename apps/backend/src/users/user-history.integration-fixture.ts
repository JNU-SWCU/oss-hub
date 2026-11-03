import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../platform/prisma.service';
import type { RequestSnapshot } from './user-history.types';

export type ApprovalFixture = {
  readonly userId: string;
  readonly id?: string;
  readonly status?: RequestSnapshot['status'];
  readonly createdAt?: Date;
  readonly decidedAt?: Date | null;
  readonly decidedById?: string | null;
  readonly rejectionReason?: string | null;
};

export async function writeApprovalFixture(
  prisma: PrismaService,
  input: ApprovalFixture,
) {
  const request = {
    id: input.id ?? randomUUID(),
    userId: input.userId,
    status: input.status ?? 'PENDING',
    createdAt: input.createdAt ?? new Date(),
    decidedAt: input.decidedAt ?? null,
    decidedById: input.decidedById ?? null,
    rejectionReason: input.rejectionReason ?? null,
  };
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: input.userId },
      data: {
        type: 'STAFF',
        approvalStatus: request.status,
        approvalRequestId: request.id,
        approvalRequestedAt: request.createdAt,
        approvalDecidedAt: request.decidedAt,
        approvalDecidedById: request.decidedById,
        approvalReason: request.rejectionReason,
      },
    });
    await transaction.userHistory.create({
      data: {
        id: `user:${randomUUID()}`,
        userId: input.userId,
        event: 'LEGACY_IMPORT',
        source: 'MIGRATION',
        occurredAt: request.createdAt,
        data: {
          schemaVersion: 1,
          recordKind: 'REQUEST_SNAPSHOT',
          original: {
            ...request,
            createdAt: request.createdAt.toISOString(),
            decidedAt: request.decidedAt?.toISOString() ?? null,
          },
        },
      },
    });
  });
  return request;
}

export async function requestHistory(prisma: PrismaService, userId?: string) {
  const rows = await prisma.userHistory.findMany({
    where: { userId },
    orderBy: [{ occurredAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
  });
  const requests = new Map<string, RequestSnapshot>();
  for (const row of rows) {
    const data = row.data;
    if (data === null || Array.isArray(data) || typeof data !== 'object')
      continue;
    const value =
      data.recordKind === 'REQUEST_SNAPSHOT' ? data.original : data.request;
    if (value === null || Array.isArray(value) || typeof value !== 'object')
      continue;
    const {
      id,
      userId: subject,
      status,
      createdAt,
      decidedAt,
      decidedById,
      rejectionReason,
    } = value;
    if (
      typeof id !== 'string' ||
      typeof subject !== 'string' ||
      typeof createdAt !== 'string' ||
      !(decidedAt === null || typeof decidedAt === 'string') ||
      !(decidedById === null || typeof decidedById === 'string') ||
      !(rejectionReason === null || typeof rejectionReason === 'string')
    ) {
      throw new TypeError('Malformed request fixture history');
    }
    switch (status) {
      case 'PENDING':
      case 'APPROVED':
      case 'REJECTED':
      case 'REVOKED':
        requests.set(id, {
          id,
          userId: subject,
          status,
          createdAt,
          decidedAt,
          decidedById,
          rejectionReason,
        });
        break;
      default:
        throw new TypeError('Malformed request fixture status');
    }
  }
  return [...requests.values()]
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    .map((request) => ({
      ...request,
      createdAt: new Date(request.createdAt),
      decidedAt:
        request.decidedAt === null ? null : new Date(request.decidedAt),
    }));
}

export async function userAuditRows(
  prisma: PrismaService,
  filter: {
    readonly userId?: string;
    readonly actorId?: string;
    readonly targetId?: string;
    readonly action?: string;
    readonly field?: string;
  },
) {
  const rows = await prisma.userHistory.findMany({
    where: {
      ...(filter.userId === undefined ? {} : { userId: filter.userId }),
      ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
      ...(filter.field === undefined
        ? {}
        : {
            data: {
              path: ['metadata', 'changes'],
              array_contains: [{ field: filter.field }],
            },
          }),
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });
  return rows.flatMap((row) => {
    const data = row.data;
    if (
      data === null ||
      Array.isArray(data) ||
      typeof data !== 'object' ||
      data.recordKind !== 'DOMAIN_EVENT' ||
      typeof data.action !== 'string' ||
      typeof data.targetType !== 'string' ||
      typeof data.targetId !== 'string' ||
      data.metadata === undefined
    )
      return [];
    if (filter.targetId !== undefined && data.targetId !== filter.targetId)
      return [];
    if (filter.action !== undefined && data.action !== filter.action) return [];
    return [
      {
        id: row.id,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        metadata: data.metadata,
      },
    ];
  });
}
