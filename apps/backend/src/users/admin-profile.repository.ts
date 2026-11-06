import { MemberKind } from './user-contract.config';
import { randomUUID } from 'node:crypto';
import { AdminAccessRepository } from './admin-access.repository';
import { type AdminAccessActor } from './admin-access-read.repository';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UserHistoryTransaction } from './user-history.repository';
import { DomainException } from '../platform/error-code.error';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { USER_PROFILE_SELECT } from '../platform/user-profile-read.config';
import { UserTransitionRepository } from './user-transition.repository';
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
  readonly userHistoryWriter: UserHistoryTransaction;

  lockActiveAdmins(): Promise<void>;
  findActor(githubId: bigint): Promise<AdminAccessActor | null>;
  findTarget(userId: string): Promise<AdminProfileTargetRecord | null>;

  applyProfile(
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
    actorId: string,
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

@Injectable()
export class AdminProfileRepository implements AdminProfileRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly adminAccessRepository: AdminAccessRepository,
    private readonly prismaSerializationRetryRepository: PrismaSerializationRetryRepository,
    private readonly transitions: UserTransitionRepository,
  ) {}

  withTransaction<T>(
    operation: (store: AdminProfileTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prismaSerializationRetryRepository.withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation(this.adminProfileTransactionStore(transaction)),
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

  private adminProfileTransactionStore(
    transaction: Prisma.TransactionClient,
  ): AdminProfileTransactionStore {
    return {
      userHistoryWriter: transaction,
      lockActiveAdmins: this.lockActiveAdminsIn.bind(this, transaction),
      findActor: this.findActorIn.bind(this, transaction),
      findTarget: this.findTargetIn.bind(this, transaction),
      applyProfile: this.applyProfileIn.bind(this, transaction),
      applyLegacyFields: this.applyLegacyFieldsIn.bind(this, transaction),
    };
  }

  private async lockActiveAdminsIn(
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    await this.adminAccessRepository.lockActiveAdminRows(transaction);
  }

  private findActorIn(
    transaction: Prisma.TransactionClient,
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    return this.adminAccessRepository.findAdminActorByGithubId(
      transaction,
      githubId,
    );
  }

  private async findTargetIn(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<AdminProfileTargetRecord | null> {
    await this.transitions.lock(transaction, userId);
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: ADMIN_PROFILE_TARGET_SELECT,
    });
    return user ? toAdminProfileTargetRecord(user) : null;
  }

  private async applyProfileIn(
    transaction: Prisma.TransactionClient,
    userId: string,
    fields: AdminProfileWriteFields,
    changedFields: Partial<AdminProfileWriteFields>,
    actorId: string,
  ): Promise<AdminProfileApplyOutcome> {
    try {
      if (Object.keys(changedFields).length === 0) return 'applied';
      const current = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { profileCreatedAt: true, type: true, departmentType: true },
      });
      const now = new Date();
      const type = current.type === 'UNSELECTED' ? 'STUDENT' : current.type;
      await transaction.user.update({
        where: { id: userId },
        data: {
          ...changedFields,
          type,
          departmentType:
            type === 'STUDENT' ? 'DEPARTMENT' : current.departmentType,
          profileCreatedAt: current.profileCreatedAt ?? now,
          profileUpdatedAt: now,
        },
      });
      if (current.type === 'UNSELECTED') {
        await transaction.userHistory.create({
          data: {
            id: 'user:' + randomUUID(),
            userId,
            actorId,
            event: 'TYPE_CHANGED',
            source: 'APPLICATION',
            data: {
              schemaVersion: 1,
              recordKind: 'TYPE_SELECTION',
              before: current.type,
              after: type,
            },
          },
        });
      }
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

  private async applyLegacyFieldsIn(
    transaction: Prisma.TransactionClient,
    userId: string,
    fields: AdminProfileLegacyFields,
  ): Promise<void> {
    if (Object.keys(fields).length === 0) {
      return;
    }
    await transaction.user.update({
      where: { id: userId },
      data: { ...fields, profileUpdatedAt: new Date() },
    });
  }
}

function toAdminProfileTargetRecord(
  user: PrismaAdminProfileTarget,
): AdminProfileTargetRecord {
  const profile = {
    name: user.name,
    studentId: user.studentId,
    department: user.department,
  };
  return {
    id: user.id,
    githubLogin: user.nickname,
    ...profile,
    memberKind: user.type === 'UNSELECTED' ? null : user.type,
  };
}
