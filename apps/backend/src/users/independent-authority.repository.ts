import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  findAdminActorByGithubId,
  lockActiveAdminRows,
} from './admin-actor-locks';
import {
  ADMIN_ACCESS_USER_SELECT,
  toAdminAccessUserRecord,
} from './admin-access-user-projection.repository';
import type { AdminAccessActor } from './admin-access.repository.types';
import type { IndependentAuthorityTransition } from './independent-authority-transition';

export type IndependentAuthorityUserRecord = ReturnType<
  typeof toAdminAccessUserRecord
> & {
  readonly selectedRole: Prisma.UserGetPayload<{
    select: typeof ADMIN_ACCESS_USER_SELECT;
  }>['selectedRole'];
};

export interface IndependentAuthorityTransactionStore {
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  lockActiveAdmins(): Promise<number>;
  findUserForUpdate(
    userId: string,
  ): Promise<IndependentAuthorityUserRecord | null>;
  updateAuthority(
    userId: string,
    transition: IndependentAuthorityTransition,
  ): Promise<void>;
}

export interface IndependentAuthorityRepositoryPort {
  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T>;
}

type LockedUserRow = Readonly<{ id: string }>;

class PrismaIndependentAuthorityStore implements IndependentAuthorityTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return findAdminActorByGithubId(this.transaction, githubId);
  }

  lockActiveAdmins(): Promise<number> {
    return lockActiveAdminRows(this.transaction);
  }

  async findUserForUpdate(
    userId: string,
  ): Promise<IndependentAuthorityUserRecord | null> {
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
    return user === null ? null : toIndependentAuthorityUserRecord(user);
  }

  async updateAuthority(
    userId: string,
    transition: IndependentAuthorityTransition,
  ): Promise<void> {
    await this.transaction.user.update({
      where: { id: userId },
      data: {
        role: transition.role,
        selectedRole: transition.selectedRole,
        hasStaffAccess: transition.hasStaffAccess,
        hasAdminAccess: transition.hasAdminAccess,
      },
    });
  }
}

function toIndependentAuthorityUserRecord(
  user: Prisma.UserGetPayload<{ select: typeof ADMIN_ACCESS_USER_SELECT }>,
): IndependentAuthorityUserRecord {
  return {
    ...toAdminAccessUserRecord(user),
    selectedRole: user.selectedRole,
  };
}

@Injectable()
export class IndependentAuthorityRepository implements IndependentAuthorityRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaIndependentAuthorityStore(transaction)),
    );
  }
}
