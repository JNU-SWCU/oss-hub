import { Inject, Injectable } from '@nestjs/common';
import { AffiliationKind, MemberKind, Prisma } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import { DomainException } from '../../common/error-code';
import { withSerializationRetry } from '../../common/repository/prisma-serialization-retry';
import {
  USER_PROFILE_SELECT,
  resolveUserProfile,
} from '../../prisma/user-profile-read';
import { upsertUserProfile } from '../../profiles/repository/user-profile-write.repository';
import { PrismaService } from '../../prisma/prisma.service';
import {
  USERS_ERROR_CODES,
  UsersErrorCode,
} from '../domain/users-error-code.enum';
import type { AdminAccessActor } from './admin-access.repository.types';
import {
  findAdminActorByGithubId,
  lockActiveAdminRows,
} from './admin-actor-locks';
import type {
  AdminProfileApplyOutcome,
  AdminProfileLegacyFields,
  AdminProfileRepositoryPort,
  AdminProfileTargetRecord,
  AdminProfileTransactionStore,
  AdminProfileWriteFields,
} from './admin-profile.repository.types';

export type {
  AdminProfileApplyOutcome,
  AdminProfileLegacyFields,
  AdminProfileRepositoryPort,
  AdminProfileTargetRecord,
  AdminProfileTransactionStore,
  AdminProfileWriteFields,
} from './admin-profile.repository.types';

const ADMIN_PROFILE_TARGET_SELECT = {
  id: true,
  nickname: true,
  ...USER_PROFILE_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAdminProfileTarget = Prisma.UserGetPayload<{
  select: typeof ADMIN_PROFILE_TARGET_SELECT;
}>;

class PrismaAdminProfileTransactionStore implements AdminProfileTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async lockActiveAdmins(): Promise<void> {
    await lockActiveAdminRows(this.transaction);
  }

  findActor(githubId: bigint): Promise<AdminAccessActor | null> {
    return findAdminActorByGithubId(this.transaction, githubId);
  }

  async findTarget(userId: string): Promise<AdminProfileTargetRecord | null> {
    const user = await this.transaction.user.findUnique({
      where: { id: userId },
      select: ADMIN_PROFILE_TARGET_SELECT,
    });
    return user ? toAdminProfileTargetRecord(user) : null;
  }

  async applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
  ): Promise<AdminProfileApplyOutcome> {
    try {
      await upsertUserProfile(
        this.transaction,
        userId,
        {
          ...fields,

          memberKind: MemberKind.STUDENT,
          affiliationKind: AffiliationKind.DEPARTMENT,
          affiliationName: fields.department,
        },
        withAffiliationName(changedFields),
      );
      return 'applied';
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'studentIdTaken';
      }
      throw error;
    }
  }

  async applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void> {
    if (Object.keys(fields).length === 0) {
      return;
    }
    await this.transaction.userProfile.updateMany({
      where: { userId },
      data: withAffiliationName(fields),
    });
  }
}

@Injectable()
export class AdminProfileRepository implements AdminProfileRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation(new PrismaAdminProfileTransactionStore(transaction)),
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        ),
      {
        onExhausted: () =>
          new DomainException(
            USERS_ERROR_CODES[UsersErrorCode.PROFILE_UPDATE_CONFLICT],
          ),
      },
    );
  }
}

function toAdminProfileTargetRecord(
  user: PrismaAdminProfileTarget,
): AdminProfileTargetRecord {
  const profile = resolveUserProfile(user);
  return {
    id: user.id,
    githubLogin: user.nickname,
    ...profile,
    memberKind: user.profile?.memberKind ?? null,
  };
}

function withAffiliationName<T extends { readonly department?: string }>(
  fields: T,
): T & { readonly affiliationName?: string } {
  return fields.department === undefined
    ? fields
    : { ...fields, affiliationName: fields.department };
}
