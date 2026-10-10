import { Inject, Injectable } from '@nestjs/common';
import {
  AffiliationKind,
  AccountStatus,
  MemberKind,
  Prisma,
  StaffAccessRequestStatus,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import { DomainException } from '../../common/error-code';
import { withSerializationRetry } from '../../common/repository/prisma-serialization-retry';
import { PrismaService } from '../../prisma/prisma.service';
import { authorityLabel, type AuthorityLabel } from '../domain/authority-label';
import {
  findAdminActorByGithubId,
  lockActiveAdminRows,
} from './admin-actor-locks';
import type { AdminAccessActor } from './admin-access.repository.types';
import {
  USERS_ERROR_CODES,
  UsersErrorCode,
} from '../domain/users-error-code.enum';
import { insertRevokedStaffAccessRequest } from './staff-access-revocation-write';

export type MemberKindTargetProfile = {
  readonly name: string;
  readonly studentId: string | null;
  readonly department: string;
  readonly staffNumber: string | null;
  readonly memberKind: MemberKind;
  readonly affiliationKind: AffiliationKind;
  readonly affiliationName: string;
};

export type MemberKindPendingRequest = {
  readonly id: string;
  readonly status: typeof StaffAccessRequestStatus.PENDING;
  readonly createdAt: Date;
};

export type MemberKindTargetRecord = {
  readonly id: string;
  readonly githubId: bigint;
  readonly githubLogin: string;
  readonly name: string | null;
  readonly role: AuthorityLabel | null;
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

export type MemberKindUpdateOutcome = 'updated' | 'studentIdTaken';

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

class PrismaMemberKindTransactionStore implements MemberKindTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async lockActiveAdmins(): Promise<void> {
    await lockActiveAdminRows(this.transaction);
  }

  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null> {
    return findAdminActorByGithubId(this.transaction, githubId);
  }

  async findTargetForUpdate(
    userId: string,
  ): Promise<MemberKindTargetRecord | null> {
    const userRows = await this.transaction.$queryRaw<readonly LockedRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
    );
    if (userRows.length !== 1) {
      return null;
    }

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "userId" FROM "UserProfile" WHERE "userId" = ${userId} FOR UPDATE`,
    );
    const user = await this.transaction.user.findUnique({
      where: { id: userId },
      select: MEMBER_KIND_TARGET_SELECT,
    });
    return user ? toMemberKindTargetRecord(user) : null;
  }

  async updateMemberKind(
    userId: string,
    hasStaffAccess: boolean,
    selectedMemberKind: MemberKind,
    profile: MemberKindProfileUpdate,
  ): Promise<MemberKindUpdateOutcome> {
    try {
      await this.transaction.user.update({
        where: { id: userId },
        data: { selectedMemberKind, hasStaffAccess },
      });
      await this.transaction.userProfile.update({
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

  insertRevokedRequest(input: {
    readonly userId: string;
    readonly actorId: string;
    readonly decidedAt: Date;
  }): Promise<{ readonly id: string }> {
    return insertRevokedStaffAccessRequest(this.transaction, input);
  }
}

@Injectable()
export class MemberKindRepository implements MemberKindRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T> {
    return withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation(new PrismaMemberKindTransactionStore(transaction)),
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
    role: authorityLabel({
      memberKind,
      hasStaffAccess: user.hasStaffAccess,
      hasAdminAccess: user.hasAdminAccess,
    }),
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
