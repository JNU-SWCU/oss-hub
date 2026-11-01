import { USER_PROFILE_NAME_SELECT } from '../platform/user-profile-read.config';
import {
  AccountStatus,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
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
      operation(this.adminAccessTransactionStore(transaction)),
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

  private adminAccessTransactionStore(
    transaction: Prisma.TransactionClient,
  ): AdminAccessTransactionStore {
    return {
      auditLogWriter: transaction,
      findActorByGithubId: this.findActorByGithubIdIn.bind(this, transaction),
      lockActiveAdmins: this.lockActiveAdminsIn.bind(this, transaction),
      findUserForUpdate: this.findUserForUpdateIn.bind(this, transaction),
      compareAndSwapAccess: this.compareAndSwapAccessIn.bind(this, transaction),
      decidePendingRequest: this.decidePendingRequestIn.bind(this, transaction),
      insertRevokedRequest: this.insertRevokedRequestIn.bind(this, transaction),
    };
  }

  private findActorByGithubIdIn(
    transaction: Prisma.TransactionClient,
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    return this.findAdminActorByGithubId(transaction, githubId);
  }

  private lockActiveAdminsIn(
    transaction: Prisma.TransactionClient,
  ): Promise<number> {
    return this.lockActiveAdminRows(transaction);
  }

  private async findUserForUpdateIn(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<AdminAccessUserRow | null> {
    const rows = await transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
    );
    if (rows.length !== 1) {
      return null;
    }
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: this.adminAccessReadRepository.ADMIN_ACCESS_USER_SELECT,
    });
    return user
      ? this.adminAccessReadRepository.toAdminAccessUserRow(user)
      : null;
  }

  private async compareAndSwapAccessIn(
    transaction: Prisma.TransactionClient,
    input: AdminAccessUserUpdate,
  ): Promise<boolean> {
    const result = await transaction.user.updateMany({
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

  private async decidePendingRequestIn(
    transaction: Prisma.TransactionClient,
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean> {
    const result = await transaction.staffAccessRequest.updateMany({
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

  private insertRevokedRequestIn(
    transaction: Prisma.TransactionClient,
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return this.insertRevokedStaffAccessRequest(transaction, input);
  }
}
