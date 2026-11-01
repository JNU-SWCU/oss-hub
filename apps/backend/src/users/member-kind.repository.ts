import { AdminAccessRepository } from './admin-access.repository';
import { type AdminAccessActor } from './admin-access-read.repository';
import { Inject, Injectable } from '@nestjs/common';
import {
  AffiliationKind,
  AccountStatus,
  MemberKind,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { DomainException } from '../platform/error-code.error';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { PrismaService } from '../platform/prisma.service';

import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';

type MemberKindTargetProfile = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly staffNumber: string | null;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

type MemberKindPendingRequest = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: Date;
};

export type MemberKindTargetRecord = {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly selectedMemberKind: MemberKind | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;
  readonly profile: MemberKindTargetProfile | null;
  readonly pendingRequest: MemberKindPendingRequest | null;
};

export type MemberKindProfileUpdate = {
  readonly memberKind: MemberKind;
  readonly studentId?: string;
  readonly department?: string;
  readonly affiliationKind?: AffiliationKind;
  readonly affiliationName?: string;
  readonly staffNumber?: string | null;
};

type MemberKindUpdateOutcome = 'updated' | 'studentIdTaken';

export interface MemberKindTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  lockActiveAdmins(): Promise<void>;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  findTargetForUpdate(userId: string): Promise<MemberKindTargetRecord | null>;
  updateMemberKind(
    userId: string,
    hasStaffAccess: boolean,
    selectedMemberKind: MemberKind,
    profile: MemberKindProfileUpdate,
  ): Promise<MemberKindUpdateOutcome>;
  insertRevokedRequest(input: {
    readonly userId: string;
    readonly actorId: string;
    readonly decidedAt: Date;
  }): Promise<{ readonly id: string }>;
}

export interface MemberKindRepositoryPort {
  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T>;
}

const MEMBER_KIND_TARGET_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  accountStatus: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      staffNumber: true,
      memberKind: true,
      affiliationKind: true,
      affiliationName: true,
    },
  },
  staffAccessRequests: {
    where: { status: StaffAccessRequestStatus.PENDING },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { id: true, status: true, createdAt: true },
  },
} as const satisfies Prisma.UserSelect;

type PrismaMemberKindTarget = Prisma.UserGetPayload<{
  select: typeof MEMBER_KIND_TARGET_SELECT;
}>;

type LockedRow = Readonly<{ id: string }>;

@Injectable()
export class MemberKindRepository implements MemberKindRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly adminAccessRepository: AdminAccessRepository,
    private readonly prismaSerializationRetryRepository: PrismaSerializationRetryRepository,
  ) {}

  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prismaSerializationRetryRepository.withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation(this.memberKindTransactionStore(transaction)),
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

  private memberKindTransactionStore(
    transaction: Prisma.TransactionClient,
  ): MemberKindTransactionStore {
    return {
      auditLogWriter: transaction,
      lockActiveAdmins: this.lockActiveAdminsIn.bind(this, transaction),
      findActorByGithubId: this.findActorByGithubIdIn.bind(this, transaction),
      findTargetForUpdate: this.findTargetForUpdateIn.bind(this, transaction),
      updateMemberKind: this.updateMemberKindIn.bind(this, transaction),
      insertRevokedRequest: this.insertRevokedRequestIn.bind(this, transaction),
    };
  }

  private async lockActiveAdminsIn(
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    await this.adminAccessRepository.lockActiveAdminRows(transaction);
  }

  private findActorByGithubIdIn(
    transaction: Prisma.TransactionClient,
    githubId: bigint,
  ): Promise<AdminAccessActor | null> {
    return this.adminAccessRepository.findAdminActorByGithubId(
      transaction,
      githubId,
    );
  }

  private async findTargetForUpdateIn(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<MemberKindTargetRecord | null> {
    const userRows = await transaction.$queryRaw<readonly LockedRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
    );
    if (userRows.length !== 1) {
      return null;
    }

    await transaction.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "UserProfile" WHERE "userId" = ${userId} FOR UPDATE`,
    );
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: MEMBER_KIND_TARGET_SELECT,
    });
    return user ? toMemberKindTargetRecord(user) : null;
  }

  private async updateMemberKindIn(
    transaction: Prisma.TransactionClient,
    userId: string,
    hasStaffAccess: boolean,
    selectedMemberKind: MemberKind,
    profile: MemberKindProfileUpdate,
  ): Promise<MemberKindUpdateOutcome> {
    try {
      await transaction.user.update({
        where: { id: userId },
        data: { selectedMemberKind, hasStaffAccess },
      });
      await transaction.userProfile.update({
        where: { userId },
        data: profile,
      });
      return 'updated';
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'studentIdTaken';
      }
      throw error;
    }
  }

  private insertRevokedRequestIn(
    transaction: Prisma.TransactionClient,
    input: {
      readonly userId: string;
      readonly actorId: string;
      readonly decidedAt: Date;
    },
  ): Promise<{ readonly id: string }> {
    return this.adminAccessRepository.insertRevokedStaffAccessRequest(
      transaction,
      input,
    );
  }
}

function toMemberKindTargetRecord(
  user: PrismaMemberKindTarget,
): MemberKindTargetRecord {
  const profile = user.profile;
  const memberKind = profile?.memberKind ?? null;
  const pendingRequest = user.staffAccessRequests[0];
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: profile?.name ?? null,
    selectedMemberKind: user.selectedMemberKind,
    memberKind,
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    accountStatus: user.accountStatus,
    profile: profile
      ? {
          name: profile.name,
          studentId: profile.studentId,
          department: profile.department,
          staffNumber: profile.staffNumber,
          memberKind: profile.memberKind,
          affiliationKind: profile.affiliationKind,
          affiliationName: profile.affiliationName,
        }
      : null,
    pendingRequest: pendingRequest
      ? {
          id: pendingRequest.id,
          status: StaffAccessRequestStatus.PENDING,
          createdAt: pendingRequest.createdAt,
        }
      : null,
  };
}
