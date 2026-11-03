import type { ApprovalStatus } from '@prisma/client';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import {
  StaffAccessRequestStatus,
  type MemberKind,
} from './user-contract.config';
import { AdminAccessRepository } from './admin-access.repository';
import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import type { UserHistoryTransaction } from './user-history.repository';
import { PrismaService } from '../platform/prisma.service';

interface AccountDeactivationTarget {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly displayName: string | null;

  readonly memberKind: MemberKind | null;
  readonly approvalStatus: ApprovalStatus;
  readonly profileCreatedAt: Date | null;
  readonly department: string | null;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: StaffAccessRequestStatus | null;
}

export interface AccountDeactivationTransactionStore {
  readonly auditLogWriter: UserHistoryTransaction;
  findForUpdate(githubId: bigint): Promise<AccountDeactivationTarget | null>;
  lockActiveAdmins(): Promise<number>;
  deactivate(userId: string): Promise<boolean>;
}

export interface AccountDeactivationRepositoryPort {
  withTransaction<T>(
    operation: (store: AccountDeactivationTransactionStore) => Promise<T>,
  ): Promise<T>;
}

const ACCOUNT_DEACTIVATION_TARGET_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  accountStatus: true,
  ...USER_AUTHORITY_SELECT,
  approvalRequestId: true,
} as const satisfies Prisma.UserSelect;

type PrismaAccountDeactivationTarget = Prisma.UserGetPayload<{
  select: typeof ACCOUNT_DEACTIVATION_TARGET_SELECT;
}>;

type LockedUserRow = Readonly<{ id: string }>;

@Injectable()
export class AccountDeactivationRepository implements AccountDeactivationRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly adminAccessRepository: AdminAccessRepository,
  ) {}

  withTransaction<T>(
    operation: (store: AccountDeactivationTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.accountDeactivationTransactionStore(transaction)),
    );
  }

  private accountDeactivationTransactionStore(
    transaction: Prisma.TransactionClient,
  ): AccountDeactivationTransactionStore {
    return {
      auditLogWriter: transaction,
      findForUpdate: this.findForUpdateIn.bind(this, transaction),
      lockActiveAdmins: this.lockActiveAdminsIn.bind(this, transaction),
      deactivate: this.deactivateIn.bind(this, transaction),
    };
  }

  private async findForUpdateIn(
    transaction: Prisma.TransactionClient,
    githubId: bigint,
  ): Promise<AccountDeactivationTarget | null> {
    const rows = await transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE "githubId" = ${githubId} FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) return null;

    const user = await transaction.user.findUnique({
      where: { id: row.id },
      select: ACCOUNT_DEACTIVATION_TARGET_SELECT,
    });
    return user ? toAccountDeactivationTarget(user) : null;
  }

  private lockActiveAdminsIn(
    transaction: Prisma.TransactionClient,
  ): Promise<number> {
    return this.adminAccessRepository.lockActiveAdminRows(transaction);
  }

  private async deactivateIn(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const result = await transaction.user.updateMany({
      where: { id: userId, accountStatus: AccountStatus.ACTIVE },
      data: { accountStatus: AccountStatus.DEACTIVATED },
    });
    return result.count === 1;
  }
}

function toAccountDeactivationTarget(
  user: PrismaAccountDeactivationTarget,
): AccountDeactivationTarget {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    displayName: user.name,
    memberKind: user.type === 'UNSELECTED' ? null : user.type,
    approvalStatus: user.approvalStatus,
    profileCreatedAt: user.profileCreatedAt,
    department: user.department,
    hasAdminAccess: user.admin !== null,
    accountStatus: user.accountStatus,
    requestStatus:
      user.approvalStatus === 'PENDING' && user.approvalRequestId !== null
        ? 'PENDING'
        : null,
  };
}
