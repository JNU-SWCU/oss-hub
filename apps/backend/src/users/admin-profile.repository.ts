import { AdminAccessRepository } from './admin-access.repository';
import { type AdminAccessActor } from './admin-access-read.repository';
import { Inject, Injectable } from '@nestjs/common';
import { AffiliationKind, MemberKind, Prisma } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { DomainException } from '../platform/error-code.error';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { USER_PROFILE_SELECT } from '../platform/user-profile-read.config';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaService } from '../platform/prisma.service';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';

export type AdminProfileTargetRecord = {
  readonly id: string;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly memberKind?: MemberKind | null;
};

export type AdminProfileWriteFields = {
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
};

export type AdminProfileLegacyFields = {
  readonly name?: string;
  readonly department?: string;
};

export type AdminProfileApplyOutcome = 'applied' | 'studentIdTaken';

export interface AdminProfileTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;

  lockActiveAdmins(): Promise<void>;
  findActor(githubId: bigint): Promise<AdminAccessActor | null>;
  findTarget(userId: string): Promise<AdminProfileTargetRecord | null>;

  applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
  ): Promise<AdminProfileApplyOutcome>;
  applyLegacyFields(
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void>;
}

export interface AdminProfileRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T>;
}

const ADMIN_PROFILE_TARGET_SELECT = {
  id: true,
  nickname: true,
  ...USER_PROFILE_SELECT,
} as const satisfies Prisma.UserSelect;

type PrismaAdminProfileTarget = Prisma.UserGetPayload<{
  select: typeof ADMIN_PROFILE_TARGET_SELECT;
}>;

class PrismaAdminProfileTransactionRepository implements AdminProfileTransactionStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly adminAccessRepository: AdminAccessRepository,
    private readonly platformRepository: PlatformRepository,
  ) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async lockActiveAdmins(): Promise<void> {
    await this.adminAccessRepository.lockActiveAdminRows(this.transaction);
  }

  findActor(githubId: bigint): Promise<AdminAccessActor | null> {
    return this.adminAccessRepository.findAdminActorByGithubId(
      this.transaction,
      githubId,
    );
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
      await this.platformRepository.upsertUserProfile(
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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly adminAccessRepository: AdminAccessRepository,
    private readonly prismaSerializationRetryRepository: PrismaSerializationRetryRepository,
    private readonly platformRepository: PlatformRepository,
  ) {}

  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prismaSerializationRetryRepository.withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation(
              new PrismaAdminProfileTransactionRepository(
                transaction,
                this.adminAccessRepository,
                this.platformRepository,
              ),
            ),
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
  const profile = {
    name: user.profile?.name ?? null,
    studentId: user.profile?.studentId ?? null,
    department: user.profile?.department ?? null,
  };
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
