import { AdminAccessRepository } from './admin-access.repository';
import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { PrismaService } from '../platform/prisma.service';
import type { MemberKind } from '@prisma/client';

interface AccountDeactivationTarget {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly displayName: string | null;

  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: StaffAccessRequestStatus | null;
}

export interface AccountDeactivationTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
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
  hasStaffAccess: true,
  hasAdminAccess: true,
  staffAccessRequests: {
    where: { status: StaffAccessRequestStatus.PENDING },
    select: { status: true },
    take: 1,
  },
  profile: { select: { name: true, memberKind: true } },
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
    displayName: user.profile?.name ?? null,
    memberKind: user.profile?.memberKind ?? null,
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    accountStatus: user.accountStatus,
    requestStatus: user.staffAccessRequests[0]?.status ?? null,
  };
}
