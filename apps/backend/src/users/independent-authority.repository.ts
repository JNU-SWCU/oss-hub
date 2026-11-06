import type { ApprovalStatus } from '@prisma/client';
import { AdminRepository } from './admin.repository';
import { randomUUID } from 'node:crypto';
import { MemberKind } from './user-contract.config';
import {
  AdminAccessReadRepository,
  type AdminAccessUserRecord,
  type AdminAccessUserRow,
  type AdminAccessActor,
  type AdminAccessInsertedRequest,
  type AdminAccessRevokedRequestInsert,
} from './admin-access-read.repository';
import { AdminAccessRepository } from './admin-access.repository';
import type { AuthorityLabel } from './authority-label.types';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { Prisma } from '@prisma/client';
import type { UserHistoryTransaction } from './user-history.repository';
import {
  ADMIN_ACCESS_COMMANDS,
  STAFF_ACCESS_COMMANDS,
  AUTHORITY_TARGETS,
} from './admin-access-query.config';

type GrantStaffAccessCommand = {
  readonly command: typeof STAFF_ACCESS_COMMANDS.GRANT;
};

type RevokeStaffAccessCommand = {
  readonly command: typeof STAFF_ACCESS_COMMANDS.REVOKE;
};

export type StaffAccessMutationCommand =
  GrantStaffAccessCommand | RevokeStaffAccessCommand;

type GrantAdminAccessCommand = {
  readonly command: typeof ADMIN_ACCESS_COMMANDS.GRANT;
};

type RevokeAdminAccessCommand = {
  readonly command: typeof ADMIN_ACCESS_COMMANDS.REVOKE;
};

export type AdminAuthorityMutationCommand =
  GrantAdminAccessCommand | RevokeAdminAccessCommand;

export type IndependentAuthorityMutationResult = {
  readonly approvalStatus: ApprovalStatus;
  readonly approvalRequestId: string | null;
  readonly id: string;
  readonly role: AuthorityLabel | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type IndependentAuthorityUserRecord = AdminAccessUserRecord & {
  readonly selectedMemberKind: MemberKind | null;
};

export type AuthorityTarget =
  (typeof AUTHORITY_TARGETS)[keyof typeof AUTHORITY_TARGETS];

export type IndependentAuthorityState = {
  readonly memberKind: MemberKind | null;
  readonly selectedMemberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type IndependentAuthorityTransition = IndependentAuthorityState & {
  readonly role: AuthorityLabel | null;
};

export interface IndependentAuthorityTransactionStore {
  readonly userHistoryWriter: UserHistoryTransaction;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  lockActiveAdmins(): Promise<number>;
  findUserForUpdate(userId: string): Promise<AdminAccessUserRow | null>;
  updateAuthority(
    userId: string,
    transition: IndependentAuthorityTransition & { readonly actorId: string },
  ): Promise<
    Pick<
      IndependentAuthorityMutationResult,
      'approvalStatus' | 'approvalRequestId'
    >
  >;

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest>;
}

export interface IndependentAuthorityRepositoryPort {
  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T>;
}

type LockedUserRow = Readonly<{ id: string }>;

@Injectable()
export class IndependentAuthorityRepository implements IndependentAuthorityRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly adminAccessReadRepository: AdminAccessReadRepository,
    private readonly adminAccessRepository: AdminAccessRepository,
    private readonly admins: AdminRepository,
  ) {}

  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(this.independentAuthorityStore(transaction)),
    );
  }

  private independentAuthorityStore(
    transaction: Prisma.TransactionClient,
  ): IndependentAuthorityTransactionStore {
    return {
      userHistoryWriter: transaction,
      findActorByGithubId: this.findActorByGithubIdIn.bind(this, transaction),
      lockActiveAdmins: this.lockActiveAdminsIn.bind(this, transaction),
      findUserForUpdate: this.findUserForUpdateIn.bind(this, transaction),
      updateAuthority: this.updateAuthorityIn.bind(this, transaction),
      insertRevokedRequest: this.insertRevokedRequestIn.bind(this, transaction),
    };
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

  private lockActiveAdminsIn(
    transaction: Prisma.TransactionClient,
  ): Promise<number> {
    return this.adminAccessRepository.lockActiveAdminRows(transaction);
  }

  private async findUserForUpdateIn(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<AdminAccessUserRow | null> {
    const rows = await transaction.$queryRaw<readonly LockedUserRow[]>(
      Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
    );
    if (rows.length !== 1) {
      return null;
    }
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: this.adminAccessReadRepository.ADMIN_ACCESS_USER_SELECT,
    });
    return user === null
      ? null
      : this.adminAccessReadRepository.toAdminAccessUserRow(user);
  }

  private async updateAuthorityIn(
    transaction: Prisma.TransactionClient,
    userId: string,
    transition: IndependentAuthorityTransition & { readonly actorId: string },
  ): Promise<
    Pick<
      IndependentAuthorityMutationResult,
      'approvalStatus' | 'approvalRequestId'
    >
  > {
    const current = await transaction.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        type: true,
        approvalStatus: true,
        approvalRequestId: true,
        admin: { select: { userId: true } },
      },
    });
    if ((current.admin !== null) !== transition.hasAdminAccess) {
      await this.admins.setAuthority(transaction, {
        userId,
        actorId: transition.actorId,
        enabled: transition.hasAdminAccess,
      });
    }
    if (transition.hasStaffAccess && current.approvalStatus !== 'APPROVED') {
      const now = new Date();
      return transaction.user.update({
        where: { id: userId },
        data: {
          approvalStatus: 'APPROVED',
          approvalRequestId: randomUUID(),
          approvalRequestedAt: now,
          approvalDecidedAt: now,
          approvalDecidedById: transition.actorId,
          approvalReason: null,
        },
        select: { approvalStatus: true, approvalRequestId: true },
      });
    }
    return {
      approvalStatus: current.approvalStatus,
      approvalRequestId: current.approvalRequestId,
    };
  }

  private insertRevokedRequestIn(
    transaction: Prisma.TransactionClient,
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return this.adminAccessRepository.insertRevokedStaffAccessRequest(
      transaction,
      input,
    );
  }
}
