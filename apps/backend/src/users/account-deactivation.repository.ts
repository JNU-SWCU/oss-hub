import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, Role, RoleRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import { PrismaService } from '../prisma/prisma.service';
import { lockActiveAdminRows } from './admin-actor-locks';

export interface AccountDeactivationTarget {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly displayName: string | null;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly requestStatus: RoleRequestStatus | null;
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
  role: true,
  accountStatus: true,
  roleRequests: {
    where: { status: RoleRequestStatus.PENDING },
    select: { status: true },
    take: 1,
  },
  ...COMPATIBLE_PROFILE_NAME_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAccountDeactivationTarget = Prisma.UserGetPayload<{
  select: typeof ACCOUNT_DEACTIVATION_TARGET_SELECT;
}>;

type LockedUserRow = Readonly<{ id: string }>;

class PrismaAccountDeactivationTransactionStore implements AccountDeactivationTransactionStore {
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
    return lockActiveAdminRows(this.transaction);
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
      operation(new PrismaAccountDeactivationTransactionStore(transaction)),
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
    displayName: resolveCompatibleProfileName(user),
    role: user.role,
    accountStatus: user.accountStatus,
    requestStatus: user.roleRequests[0]?.status ?? null,
  };
}
