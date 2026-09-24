import { Inject, Injectable } from '@nestjs/common';
import { Prisma, StaffAccessRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  findAdminActorByGithubId,
  lockActiveAdminRows,
} from './admin-actor-locks';
import {
  listAdminAccessLoginHistory,
  listAdminAccessStaffAccessRequestHistory,
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
  AdminAccessStaffAccessRequestHistoryPage,
} from './domain/admin-access';
import { insertRevokedStaffAccessRequest } from './staff-access-revocation-write';

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
        hasStaffAccess: input.expectedHasStaffAccess,
        hasAdminAccess: input.expectedHasAdminAccess,
        accountStatus: input.expectedAccountStatus,
      },
      data: {
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
    const result = await this.transaction.staffAccessRequest.updateMany({
      where: { id: input.requestId, status: StaffAccessRequestStatus.PENDING },
      data: {
        status: input.nextStatus,
        rejectionReason: input.rejectionReason,
        decidedById: input.actorId,
        decidedAt: input.decidedAt,
      },
    });
    return result.count === 1;
  }

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return insertRevokedStaffAccessRequest(this.transaction, input);
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

  list(
    query: AdminAccessListQuery,
    sortContext: 'directory' | 'requestQueue' = 'directory',
  ) {
    return listAdminAccessUsers(this.prisma, query, sortContext);
  }

  facets(query: AdminAccessListQuery) {
    return listAdminAccessFacets(this.prisma, query);
  }

  findById(userId: string) {
    return findAdminAccessUserById(this.prisma, userId);
  }

  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    return listAdminAccessStaffAccessRequestHistory(this.prisma, userId, page);
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return listAdminAccessLoginHistory(this.prisma, userId, page);
  }
}
