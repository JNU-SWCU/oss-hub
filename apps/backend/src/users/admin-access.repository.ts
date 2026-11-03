import { randomUUID } from 'node:crypto';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { AdminRepository } from './admin.repository';
import { UserTransitionRepository } from './user-transition.repository';
import { Prisma } from '@prisma/client';
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
  accountStatus: true,
  approvalRequestId: true,
  ...USER_AUTHORITY_SELECT,
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
    private readonly admins: AdminRepository,
    private readonly transitions: UserTransitionRepository,
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
    return this.admins.lockActiveRows(transaction);
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
      name: user.name,
      memberKind: user.type === 'UNSELECTED' ? null : user.type,
      approvalStatus: user.approvalStatus,
      profileCreatedAt: user.profileCreatedAt,
      department: user.department,
      hasAdminAccess: user.admin !== null,
      accountStatus: user.accountStatus,
    };
  }

  async insertRevokedStaffAccessRequest(
    transaction: Prisma.TransactionClient,
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return this.transitions.revoke(transaction, input);
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

  private async findActorByGithubIdIn(
    transaction: Prisma.TransactionClient,
    githubId: bigint,
    forUpdate = false,
  ): Promise<AdminAccessActor | null> {
    if (forUpdate)
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "User" WHERE "githubId" = ${githubId} FOR UPDATE`,
      );
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
    const before = await transaction.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: ADMIN_ACTOR_SELECT,
    });
    if (
      before.type !== input.expectedType ||
      before.approvalStatus !== input.expectedApprovalStatus ||
      before.approvalRequestId !== input.expectedApprovalRequestId ||
      (before.admin !== null) !== input.expectedHasAdminAccess ||
      before.accountStatus !== input.expectedAccountStatus
    )
      return false;
    if (
      input.desiredHasStaffAccess &&
      !input.expectedHasStaffAccess &&
      !input.decidesPendingRequest &&
      before.type !== 'STAFF'
    ) {
      const changed = await this.transitions.changeType(transaction, {
        userId: input.userId,
        actorId: input.actorId,
        expected: {
          type: input.expectedType,
          approvalStatus: input.expectedApprovalStatus,
          approvalRequestId: input.expectedApprovalRequestId,
        },
        profile: { memberKind: 'STAFF' },
      });
      if (changed === null) return false;
    }
    if (input.desiredHasAdminAccess !== input.expectedHasAdminAccess) {
      await this.admins.setAuthority(transaction, {
        userId: input.userId,
        actorId: input.actorId,
        enabled: input.desiredHasAdminAccess,
      });
    }
    await transaction.user.update({
      where: { id: input.userId },
      data: {
        accountStatus: input.desiredAccountStatus,
        ...(before.type === 'STAFF' &&
        input.desiredHasStaffAccess &&
        !input.expectedHasStaffAccess &&
        !input.decidesPendingRequest
          ? {
              approvalStatus: 'APPROVED',
              approvalRequestId: randomUUID(),
              approvalRequestedAt: new Date(),
              approvalDecidedAt: new Date(),
              approvalDecidedById: input.actorId,
              approvalReason: null,
            }
          : {}),
      },
    });
    return true;
  }

  private async decidePendingRequestIn(
    transaction: Prisma.TransactionClient,
    input: AdminAccessPendingDecisionUpdate,
  ): Promise<boolean> {
    const result = await transaction.user.updateMany({
      where: {
        type: 'STAFF',
        approvalRequestId: input.requestId,
        approvalStatus: 'PENDING',
      },
      data: {
        approvalStatus: input.nextStatus,
        approvalReason: input.rejectionReason,
        approvalDecidedById: input.actorId,
        approvalDecidedAt: input.decidedAt,
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
