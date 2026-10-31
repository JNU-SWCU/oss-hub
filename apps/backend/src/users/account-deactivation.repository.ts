import { AdminAccessRepository } from './admin-access.repository';
import { resolveUserProfileName } from '../platform/user-profile-read.config';
import { authorityLabel } from './authority-label.config';
import type { AuthorityLabel } from './authority-label.types';
import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { PrismaService } from '../platform/prisma.service';

interface AccountDeactivationTarget {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly displayName: string | null;

  readonly role: AuthorityLabel | null;
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

class PrismaAccountDeactivationTransactionRepository implements AccountDeactivationTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async findForUpdate(
    githubId: bigint,
  ): Promise<AccountDeactivationTarget | null> {
    const rows = await this.transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE "githubId" = ${githubId} FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) return null;

    const user = await this.transaction.user.findUnique({
      where: { id: row.id },
      select: ACCOUNT_DEACTIVATION_TARGET_SELECT,
    });
    return user ? toAccountDeactivationTarget(user) : null;
  }

  lockActiveAdmins(): Promise<number> {
    return AdminAccessRepository.lockActiveAdminRows(this.transaction);
  }

  async deactivate(userId: string): Promise<boolean> {
    const result = await this.transaction.user.updateMany({
      where: { id: userId, accountStatus: AccountStatus.ACTIVE },
      data: { accountStatus: AccountStatus.DEACTIVATED },
    });
    return result.count === 1;
  }
}

@Injectable()
export class AccountDeactivationRepository implements AccountDeactivationRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: AccountDeactivationTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(
        new PrismaAccountDeactivationTransactionRepository(transaction),
      ),
    );
  }
}

function toAccountDeactivationTarget(
  user: PrismaAccountDeactivationTarget,
): AccountDeactivationTarget {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    displayName: resolveUserProfileName(user),
    role: authorityLabel({
      memberKind: user.profile?.memberKind ?? null,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
    }),
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    accountStatus: user.accountStatus,
    requestStatus: user.staffAccessRequests[0]?.status ?? null,
  };
}
