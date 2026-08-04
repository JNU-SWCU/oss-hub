import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, Role, RoleRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.store';
import {
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import { PrismaService } from '../prisma/prisma.service';
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
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
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
  AdminAccessPendingDecisionUpdate,
  AdminAccessRepositoryPort,
  AdminAccessTransactionStore,
  AdminAccessUserDetailRecord,
  AdminAccessUserPageRecord,
  AdminAccessUserRecord,
  AdminAccessUserUpdate,
} from './admin-access.repository.types';

const ADMIN_ACCESS_ACTOR_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  role: true,
  accountStatus: true,
  ...COMPATIBLE_PROFILE_NAME_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAdminAccessActor = Prisma.UserGetPayload<{
  select: typeof ADMIN_ACCESS_ACTOR_SELECT;
}>;
type LockedUserRow = Readonly<{ id: string }>;

class PrismaAdminAccessTransactionStore implements AdminAccessTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async findActorByGithubId(
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    const actor = await this.transaction.user.findUnique({
      where: { githubId },
      select: ADMIN_ACCESS_ACTOR_SELECT,
    });
    return actor ? toAdminAccessActor(actor) : null;
  }

  async lockActiveAdmins(): Promise<number> {
    const rows = await this.transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`
        SELECT id
        FROM "User"
        WHERE role = ${Role.ADMIN}::"Role"
          AND "accountStatus" = ${AccountStatus.ACTIVE}::"AccountStatus"
        ORDER BY id
        FOR UPDATE
      `,
    );
    return rows.length;
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

  async findActorByGithubId(
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    const actor = await this.prisma.user.findUnique({
      where: { githubId },
      select: ADMIN_ACCESS_ACTOR_SELECT,
    });
    return actor ? toAdminAccessActor(actor) : null;
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

function toAdminAccessActor(user: PrismaAdminAccessActor): AdminAccessActor {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: resolveCompatibleProfileName(user),
    role: user.role,
    accountStatus: user.accountStatus,
  };
}
