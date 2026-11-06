import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { randomUUID } from 'node:crypto';
const TARGET_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  accountStatus: true,
  phone: true,
  staffNumber: true,
  ...USER_AUTHORITY_SELECT,
  ...USER_APPROVAL_SELECT,
} satisfies Prisma.UserSelect;
export type MemberRegistrationResetTarget = Prisma.UserGetPayload<{
  select: typeof TARGET_SELECT;
}>;
export interface MemberRegistrationResetStore {
  readonly userHistoryWriter: UserHistoryTransaction;
  lockActiveAdmins(): Promise<void>;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  findTargetForUpdate(
    userId: string,
  ): Promise<MemberRegistrationResetTarget | null>;
  hasActivity(userId: string): Promise<boolean>;
  resetRegistration(
    target: MemberRegistrationResetTarget,
    actorId: string,
  ): Promise<boolean>;
}
export interface MemberRegistrationResetPort {
  withTransaction<T>(
    operation: (store: MemberRegistrationResetStore) => Promise<T>,
  ): Promise<T>;
}
@Injectable()
export class MemberRegistrationResetRepository implements MemberRegistrationResetPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AdminAccessRepository,
    private readonly retry: PrismaSerializationRetryRepository,
    private readonly transitions: UserTransitionRepository,
  ) {}
  withTransaction<T>(
    operation: (store: MemberRegistrationResetStore) => Promise<T>,
  ): Promise<T> {
    return this.retry.withSerializationRetry(
      () =>
        this.prisma.$transaction(
          (transaction) =>
            operation({
              userHistoryWriter: transaction,
              lockActiveAdmins: async () => {
                await this.access.lockActiveAdminRows(transaction);
              },
              findActorByGithubId: (githubId) =>
                this.access.findAdminActorByGithubId(transaction, githubId),
              findTargetForUpdate: async (userId) => {
                await this.transitions.lock(transaction, userId);
                return transaction.user.findUnique({
                  where: { id: userId },
                  select: TARGET_SELECT,
                });
              },
              hasActivity: (userId) => this.hasActivity(transaction, userId),
              resetRegistration: (target, actorId) =>
                this.resetRegistration(transaction, target, actorId),
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
  async hasActivity(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const history = await transaction.teamHistory.findFirst({
      where: {
        OR: [
          { actorId: userId },
          { data: { path: ['invitation', 'inviteeId'], equals: userId } },
          { data: { path: ['invitation', 'invitedById'], equals: userId } },
        ],
      },
      select: { id: true },
    });
    if (history) return true;
    return (
      (await transaction.user.count({
        where: {
          id: userId,
          OR: [
            { submittedTeams: { some: {} } },
            { processedTeams: { some: {} } },
            { ledTeams: { some: {} } },
            { teamMemberships: { some: {} } },
            { receivedTeamInvitations: { some: {} } },
            { sentTeamInvitations: { some: {} } },
            { uploadedFiles: { some: {} } },
            { submissions: { some: {} } },
            { submissionHistories: { some: {} } },
            { createdPrograms: { some: {} } },
            { approvalDecisions: { some: {} } },
            { adminGrants: { some: {} } },
          ],
        },
      })) > 0
    );
  }
  private async resetRegistration(
    transaction: Prisma.TransactionClient,
    target: MemberRegistrationResetTarget,
    actorId: string,
  ): Promise<boolean> {
    const changed = await transaction.user.updateMany({
      where: {
        id: target.id,
        type: target.type,
        approvalStatus: target.approvalStatus,
        approvalRequestId: target.approvalRequestId,
      },
      data: {
        type: 'UNSELECTED',
        approvalStatus: 'NOT_REQUIRED',
        approvalRequestId: null,
        approvalRequestedAt: null,
        approvalDecidedAt: null,
        approvalDecidedById: null,
        approvalReason: null,
        name: null,
        department: null,
        departmentType: null,
        studentId: null,
        staffNumber: null,
        phone: null,
        profileCreatedAt: null,
        profileUpdatedAt: null,
      },
    });
    if (changed.count !== 1) return false;
    const previousRequest = this.transitions.requestSnapshot(target);
    if (
      previousRequest?.status === 'PENDING' ||
      previousRequest?.status === 'APPROVED'
    ) {
      const now = new Date();
      await transaction.userHistory.create({
        data: {
          id: 'user:' + randomUUID(),
          userId: target.id,
          actorId,
          event:
            previousRequest.status === 'PENDING'
              ? 'REQUEST_SUPERSEDED'
              : 'REVOKED',
          source: 'APPLICATION',
          occurredAt: now,
          data: {
            schemaVersion: 1,
            recordKind: 'REQUEST_TRANSITION',
            cause:
              previousRequest.status === 'PENDING'
                ? 'SUPERSEDED'
                : 'TYPE_CHANGED',
            ...(previousRequest.status === 'PENDING'
              ? { replacementRequestId: null }
              : {}),
            request: {
              ...previousRequest,
              status: 'REVOKED',
              decidedAt: now.toISOString(),
              decidedById: actorId,
            },
          },
        },
      });
    }
    return true;
  }
}
