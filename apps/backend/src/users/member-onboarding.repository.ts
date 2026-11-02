import type { ApprovalStatus } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { Prisma, type AccountStatus } from '@prisma/client';
import { MemberKind, StaffAccessRequestStatus } from './user-contract.config';
import { PrismaService } from '../platform/prisma.service';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { USER_APPROVAL_SELECT } from './user-history.config';
import type { RequestSnapshot } from './user-history.types';
import { UserTransitionRepository } from './user-transition.repository';
import { randomUUID } from 'node:crypto';

type StaffAccessRequestOutcome = {
  readonly requestStatus: StaffAccessRequestStatus | null;
};
export interface ConsentUser {
  readonly id: string;
  readonly accountStatus: AccountStatus;
}

export interface ConsentRecord {
  policyVersion: string;
  consentedAt: Date;
}

export type SelectableMemberKind = MemberKind;

type MemberProfileFields = {
  readonly name: string | null;
  readonly studentId: string | null;
  readonly department: string | null;
};

export type MemberUser = {
  readonly profileCreatedAt: Date | null;
  readonly approvalStatus: ApprovalStatus;
  readonly id: string;

  readonly memberKind: MemberKind | null;

  readonly selectedMemberKind: MemberKind | null;
  readonly hasAdminAccess: boolean;
  readonly accountStatus: AccountStatus;

  readonly profile: MemberProfileFields;
};

export type StaffAccessRequestRecord = {
  readonly id: string;
  readonly userId: string;
  readonly status: StaffAccessRequestStatus;
  readonly rejectionReason: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
};

export type MemberKindSelectionResult = {
  readonly selectedMemberKind: SelectableMemberKind;

  readonly redirectTo: '/onboarding/profile';
};

export type MemberKindSelectionState = {
  readonly selectedMemberKind: SelectableMemberKind | null;
};

export interface OnboardingTransactionStore {
  findUserByGithubId(githubId: bigint): Promise<MemberUser | null>;
  updateSelectedMemberKind(
    userId: string,
    memberKind: MemberKind,
  ): Promise<MemberUser>;
  findPendingRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
  findLatestRequest(userId: string): Promise<StaffAccessRequestRecord | null>;
  createPendingRequest(userId: string): Promise<StaffAccessRequestRecord>;
  requestStaffAccess(userId: string): Promise<StaffAccessRequestOutcome>;
}

const MEMBER_USER_SELECT = {
  id: true,
  accountStatus: true,
  ...USER_AUTHORITY_SELECT,
  ...USER_APPROVAL_SELECT,
} as const satisfies Prisma.UserSelect;
type MemberUserRow = Prisma.UserGetPayload<{
  select: typeof MEMBER_USER_SELECT;
}>;

@Injectable()
export class MemberOnboardingRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: UserTransitionRepository,
  ) {}
  withTransaction<T>(
    operation: (store: OnboardingTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation({
        findUserByGithubId: async (githubId) => {
          await transaction.$queryRaw(
            Prisma.sql`SELECT "id" FROM "User" WHERE "githubId" = ${githubId} FOR UPDATE`,
          );
          const user = await transaction.user.findUnique({
            where: { githubId },
            select: MEMBER_USER_SELECT,
          });
          return user ? toMemberUser(user) : null;
        },
        updateSelectedMemberKind: async (userId, memberKind) => {
          const before = await transaction.user.findUniqueOrThrow({
            where: { id: userId },
            select: { type: true },
          });
          if (before.type === memberKind) {
            return toMemberUser(
              await transaction.user.findUniqueOrThrow({
                where: { id: userId },
                select: MEMBER_USER_SELECT,
              }),
            );
          }
          const user = await transaction.user.update({
            where: { id: userId },
            data: {
              type: memberKind,
              approvalRequestId: null,
              approvalRequestedAt: null,
              approvalDecidedAt: null,
              approvalDecidedById: null,
              approvalReason: null,
              approvalStatus:
                memberKind === 'STAFF' ? 'PENDING' : 'NOT_REQUIRED',
            },
            select: MEMBER_USER_SELECT,
          });
          await transaction.userHistory.create({
            data: {
              id: 'user:' + randomUUID(),
              userId,
              actorId: userId,
              event: 'TYPE_CHANGED',
              source: 'APPLICATION',
              data: {
                schemaVersion: 1,
                recordKind: 'TYPE_SELECTION',
                before: before.type,
                after: memberKind,
              },
            },
          });
          return toMemberUser(user);
        },
        findPendingRequest: async (userId) => {
          const current = await this.findLatestRequestIn(transaction, userId);
          return current?.status === 'PENDING' ? current : null;
        },
        findLatestRequest: (userId) =>
          this.findLatestRequestIn(transaction, userId),
        createPendingRequest: async (userId) =>
          toStaffAccessRequest(
            await this.transitions.requestStaffAccess(transaction, userId),
          ),
        requestStaffAccess: async (userId) => ({
          requestStatus: (
            await this.transitions.requestStaffAccess(transaction, userId)
          ).status,
        }),
      }),
    );
  }
  async findUserByGithubId(githubId: bigint): Promise<MemberUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: MEMBER_USER_SELECT,
    });
    return user ? toMemberUser(user) : null;
  }
  findLatestRequest(userId: string): Promise<StaffAccessRequestRecord | null> {
    return this.findLatestRequestIn(this.prisma, userId);
  }
  private async findLatestRequestIn(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<StaffAccessRequestRecord | null> {
    const user = await transaction.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, ...USER_APPROVAL_SELECT },
    });
    const request = this.transitions.requestSnapshot(user);
    return request ? toStaffAccessRequest(request) : null;
  }
}
function toMemberUser(user: MemberUserRow): MemberUser {
  return {
    id: user.id,
    profileCreatedAt: user.profileCreatedAt,
    memberKind: user.type === 'UNSELECTED' ? null : user.type,
    selectedMemberKind: user.type === 'UNSELECTED' ? null : user.type,
    approvalStatus: user.approvalStatus,
    hasAdminAccess: user.admin !== null,
    accountStatus: user.accountStatus,
    profile: {
      name: user.name,
      studentId: user.studentId,
      department: user.department,
    },
  };
}
function toStaffAccessRequest(
  request: RequestSnapshot,
): StaffAccessRequestRecord {
  return {
    ...request,
    createdAt: new Date(request.createdAt),
    decidedAt: request.decidedAt === null ? null : new Date(request.decidedAt),
  };
}
