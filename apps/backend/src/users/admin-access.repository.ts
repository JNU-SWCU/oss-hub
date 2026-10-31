import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
import {
  AccountStatus,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { PrismaService } from '../platform/prisma.service';
import { AdminAccessHistoryRepository } from './admin-access-history.repository';
import {
  AdminAccessReadRepository,
  type AdminAccessActor,
  type AdminAccessUserUpdate,
  type AdminAccessPendingDecisionUpdate,
  type AdminAccessRevokedRequestInsert,
  type AdminAccessInsertedRequest,
  type AdminAccessTransactionStore,
  type AdminAccessRepositoryPort,
} from './admin-access-read.repository';
import {
  type AdminAccessListQuery,
  type AdminAccessLoginHistoryPage,
  type AdminAccessStaffAccessRequestHistoryPage,
} from './admin-access-read-ordering.repository';
import type { AdminAccessUserRow } from './admin-access-read.repository';

const ADMIN_ACTOR_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  ...USER_PROFILE_NAME_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAdminActor = Prisma.UserGetPayload<{
  select: typeof ADMIN_ACTOR_SELECT;
}>;

type LockedUserRow = Readonly<{ id: string }>;

class PrismaAdminAccessTransactionRepository implements AdminAccessTransactionStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly adminAccessReadRepository: AdminAccessReadRepository,
    private readonly adminAccessRepository: AdminAccessRepository,
  ) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.adminAccessRepository.findAdminActorByGithubId(
      this.transaction,
      githubId,
    );
  }

  lockActiveAdmins(): Promise<number> {
    return this.adminAccessRepository.lockActiveAdminRows(this.transaction);
  }

  async findUserForUpdate(userId: string): Promise<AdminAccessUserRow | null> {
    const rows = await this.transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
    );
    if (rows.length !== 1) {
      return null;
    }
    const user = await this.transaction.user.findUnique({
      where: { id: userId },
      select: this.adminAccessReadRepository.ADMIN_ACCESS_USER_SELECT,
    });
    return user
      ? this.adminAccessReadRepository.toAdminAccessUserRow(user)
      : null;
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
    return this.adminAccessRepository.insertRevokedStaffAccessRequest(
      this.transaction,
      input,
    );
  }
}

@Injectable()
export class AdminAccessRepository implements AdminAccessRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly adminAccessHistoryRepository: AdminAccessHistoryRepository,
    private readonly adminAccessReadRepository: AdminAccessReadRepository,
  ) {}

  withTransaction<T>(
    operation: (store: AdminAccessTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(
        new PrismaAdminAccessTransactionRepository(
          transaction,
          this.adminAccessReadRepository,
          this,
        ),
      ),
    );
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.findAdminActorByGithubId(this.prisma, githubId);
  }

  list(
    query: AdminAccessListQuery,
    sortContext: 'directory' | 'requestQueue' = 'directory',
  ) {
    return this.adminAccessReadRepository.listAdminAccessUsers(
      this.prisma,
      query,
      sortContext,
    );
  }

  facets(query: AdminAccessListQuery) {
    return this.adminAccessReadRepository.listAdminAccessFacets(
      this.prisma,
      query,
    );
  }

  findById(userId: string) {
    return this.adminAccessReadRepository.findAdminAccessUserById(
      this.prisma,
      userId,
    );
  }

  listStaffAccessRequestHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessStaffAccessRequestHistoryPage> {
    return this.adminAccessHistoryRepository.listAdminAccessStaffAccessRequestHistory(
      this.prisma,
      userId,
      page,
    );
  }

  listLoginHistory(
    userId: string,
    page: { readonly page: number; readonly limit: number },
  ): Promise<AdminAccessLoginHistoryPage> {
    return this.adminAccessHistoryRepository.listAdminAccessLoginHistory(
      this.prisma,
      userId,
      page,
    );
  }

  async lockActiveAdminRows(
    transaction: Prisma.TransactionClient,
  ): Promise<number> {
    const rows = await transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`
        SELECT id
        FROM "User"
        WHERE "hasAdminAccess" = TRUE
          AND "accountStatus" = ${AccountStatus.ACTIVE}::"AccountStatus"
        ORDER BY id
        FOR UPDATE
      `,
    );
    return rows.length;
  }

  async findAdminActorByGithubId(
    transaction: Prisma.TransactionClient,
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    const actor = await transaction.user.findUnique({
      where: { githubId },
      select: ADMIN_ACTOR_SELECT,
    });
    return actor ? this.toAdminActor(actor) : null;
  }

  toAdminActor(user: PrismaAdminActor): AdminAccessActor {
    return {
      id: user.id,
      githubId: user.githubId,
      githubLogin: user.nickname,
      name: user.profile?.name ?? null,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
      accountStatus: user.accountStatus,
    };
  }

  async insertRevokedStaffAccessRequest(
    transaction: Prisma.TransactionClient,
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    const created = await transaction.staffAccessRequest.create({
      data: {
        userId: input.userId,
        status: StaffAccessRequestStatus.REVOKED,
        decidedById: input.actorId,
        decidedAt: input.decidedAt,
      },
      select: { id: true },
    });
    return { id: created.id };
  }
}
