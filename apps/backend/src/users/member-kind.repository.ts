import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type ApprovalStatus,
  type AccountStatus,
} from '@prisma/client';
import {
  MemberKind,
  AffiliationKind,
  StaffAccessRequestStatus,
} from './user-contract.config';
import { PrismaService } from '../platform/prisma.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { DomainException } from '../platform/error-code.error';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import { AdminAccessRepository } from './admin-access.repository';
import type { AdminAccessActor } from './admin-access-read.repository';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { USER_APPROVAL_SELECT } from './user-history.config';
import type { UserHistoryTransaction } from './user-history.repository';
import { UserTransitionRepository } from './user-transition.repository';
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
  readonly profileCreatedAt: Date | null;
  readonly approvalStatus: ApprovalStatus;
  readonly approvalRequestId: string | null;
  readonly memberKind: MemberKind | null;
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

type MemberKindUpdateOutcome =
  | {
      readonly kind: 'updated';
      readonly approvalStatus: ApprovalStatus;
      readonly approvalRequestId: string | null;
    }
  | 'studentIdTaken'
  | 'conflict';

export interface MemberKindTransactionStore {
  readonly auditLogWriter: UserHistoryTransaction;
  lockActiveAdmins(): Promise<void>;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  findTargetForUpdate(userId: string): Promise<MemberKindTargetRecord | null>;
  updateMemberKind(
    target: MemberKindTargetRecord,
    actorId: string,
    profile: MemberKindProfileUpdate,
  ): Promise<MemberKindUpdateOutcome>;
}

export interface MemberKindRepositoryPort {
  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T>;
}

const TARGET_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  accountStatus: true,
  staffNumber: true,
  ...USER_AUTHORITY_SELECT,
  ...USER_APPROVAL_SELECT,
} as const satisfies Prisma.UserSelect;
type TargetRow = Prisma.UserGetPayload<{ select: typeof TARGET_SELECT }>;
@Injectable()
export class MemberKindRepository implements MemberKindRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AdminAccessRepository,
    private readonly retry: PrismaSerializationRetryRepository,
    private readonly transitions: UserTransitionRepository,
  ) {}
  withTransaction<T>(
    operation: (store: MemberKindTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.retry.withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation({
              auditLogWriter: transaction,
              lockActiveAdmins: async () => {
                await this.access.lockActiveAdminRows(transaction);
              },
              findActorByGithubId: (githubId) =>
                this.access.findAdminActorByGithubId(transaction, githubId),
              findTargetForUpdate: async (userId) => {
                await this.transitions.lock(transaction, userId);
                const user = await transaction.user.findUnique({
                  where: { id: userId },
                  select: TARGET_SELECT,
                });
                return user ? toTarget(user) : null;
              },
              updateMemberKind: async (target, actorId, profile) => {
                try {
                  const updated = await this.transitions.changeType(
                    transaction,
                    {
                      userId: target.id,
                      actorId,
                      expected: {
                        type: target.memberKind ?? 'UNSELECTED',
                        approvalStatus: target.approvalStatus,
                        approvalRequestId: target.approvalRequestId,
                      },
                      profile,
                    },
                  );
                  return updated
                    ? {
                        kind: 'updated',
                        approvalStatus: updated.approvalStatus,
                        approvalRequestId: updated.approvalRequestId,
                      }
                    : 'conflict';
                } catch (error) {
                  if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2002'
                  )
                    return 'studentIdTaken';
                  throw error;
                }
              },
            }),
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
function toTarget(user: TargetRow): MemberKindTargetRecord {
  const memberKind = user.type === 'UNSELECTED' ? null : user.type;
  const profile =
    user.profileCreatedAt !== null &&
    user.name !== null &&
    user.department !== null &&
    user.departmentType !== null &&
    memberKind !== null
      ? {
          name: user.name,
          studentId: user.studentId,
          department: user.department,
          staffNumber: user.staffNumber,
          memberKind,
          affiliationKind: user.departmentType,
          affiliationName: user.department,
        }
      : null;
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: user.name,
    selectedMemberKind: memberKind,
    memberKind,
    hasAdminAccess: user.admin !== null,
    accountStatus: user.accountStatus,
    profile,
    profileCreatedAt: user.profileCreatedAt,
    approvalStatus: user.approvalStatus,
    approvalRequestId: user.approvalRequestId,
    pendingRequest:
      user.approvalStatus === 'PENDING' &&
      user.approvalRequestId !== null &&
      user.approvalRequestedAt !== null
        ? {
            id: user.approvalRequestId,
            status: 'PENDING',
            createdAt: user.approvalRequestedAt,
          }
        : null,
  };
}
