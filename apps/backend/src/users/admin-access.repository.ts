import { Inject, Injectable } from '@nestjs/common';
import { Prisma, RoleRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  findAdminActorByGithubId,
  lockActiveAdminRows,
} from './admin-actor-locks';
import {
  listAdminAccessLoginHistory,
  listAdminAccessRoleRequestHistory,
} from './admin-access-history.repository';
import {
  ADMIN_ACCESS_USER_SELECT,
  findAdminAccessUserById,
  listAdminAccessFacets,
  listAdminAccessUsers,
  toAdminAccessUserRecord,
} from './admin-access-read.repository';
import type {
  AdminAccessActor,
  AdminAccessInsertedRequest,
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
  AdminAccessRevokedRequestInsert,
  AdminAccessTransactionStore,
  AdminAccessUserRecord,
  AdminAccessUserUpdate,
} from './admin-access.repository.types';
import type {
  AdminAccessListQuery,
  AdminAccessLoginHistoryPage,
  AdminAccessRoleRequestHistoryPage,
} from './domain/admin-access';

export type {
  AdminAccessActor,
  AdminAccessInsertedRequest,
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
  AdminAccessRevokedRequestInsert,
  AdminAccessTransactionStore,
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
  AdminAccessUserUpdate,
} from './admin-access.repository.types';

type LockedUserRow = Readonly<{ id: string }>;

class PrismaAdminAccessTransactionStore implements AdminAccessTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return findAdminActorByGithubId(this.transaction, githubId);
  }

  lockActiveAdmins(): Promise<number> {
    return lockActiveAdminRows(this.transaction);
  }

  async findUserForUpdate(
    userId: string,
  ): Promise<AdminAccessUserRecord | null> {
    const rows = await this.transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
    );
    if (rows.length !== 1) {
      return null;
    }
    const user = await this.transaction.user.findUnique({
      where: { id: userId },
      select: ADMIN_ACCESS_USER_SELECT,
    });
    return user ? toAdminAccessUserRecord(user) : null;
  }

  async compareAndSwapAccess(input: AdminAccessUserUpdate): Promise<boolean> {
    const result = await this.transaction.user.updateMany({
      where: {
        id: input.userId,
        role: input.expectedRole,
        accountStatus: input.expectedAccountStatus,
      },
      data: {
        role: input.desiredRole,
        accountStatus: input.desiredAccountStatus,
        hasStaffAccess: input.desiredHasStaffAccess,
        hasAdminAccess: input.desiredHasAdminAccess,
      },
    });
    return result.count === 1;
  }

  async decidePendingRequest(
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean> {
    const result = await this.transaction.roleRequest.updateMany({
      where: { id: input.requestId, status: RoleRequestStatus.PENDING },
      data: {
        status: input.nextStatus,
        rejectionReason: input.rejectionReason,
        decidedById: input.actorId,
        decidedAt: input.decidedAt,
      },
    });
    return result.count === 1;
  }

  async insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    // partial unique(`RoleRequest_userId_pending_key`)는 PENDING 행만 묶으므로
    // REVOKED 행은 몇 번을 회수하든 매번 새로 쌓인다 — 회수·재승인이 반복된 사람의
    // 이력이 관리자 상세에서 시간순으로 그대로 읽힌다.
    const created = await this.transaction.roleRequest.create({
      data: {
        userId: input.userId,
        status: RoleRequestStatus.REVOKED,
        decidedById: input.actorId,
        decidedAt: input.decidedAt,
      },
      select: { id: true },
    });
    return { id: created.id };
  }
}

@Injectable()
export class AdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaAdminAccessTransactionStore(transaction)),
    );
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return findAdminActorByGithubId(this.prisma, githubId);
  }

  list(query: AdminAccessListQuery) {
    return listAdminAccessUsers(this.prisma, query);
  }

  facets(query: AdminAccessListQuery) {
    return listAdminAccessFacets(this.prisma, query);
  }

  findById(userId: string) {
    return findAdminAccessUserById(this.prisma, userId);
  }

  listRoleRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessRoleRequestHistoryPage> {
    return listAdminAccessRoleRequestHistory(this.prisma, userId, page);
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return listAdminAccessLoginHistory(this.prisma, userId, page);
  }
}
