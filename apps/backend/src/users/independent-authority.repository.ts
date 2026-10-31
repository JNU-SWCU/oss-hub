import { type AuthorityLabel } from './authority-label.types';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { Prisma, MemberKind } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import {
  findAdminActorByGithubId,
  lockActiveAdminRows,
  insertRevokedStaffAccessRequest,
} from './admin-access.repository';
import {
  ADMIN_ACCESS_USER_SELECT,
  AdminAccessUserProjectionRepository,
  type AdminAccessUserRecord,
  type AdminAccessActor,
  type AdminAccessInsertedRequest,
  type AdminAccessRevokedRequestInsert,
} from './admin-access-user-projection.repository';

export const STAFF_ACCESS_COMMANDS = {
  GRANT: 'GRANT_STAFF_ACCESS',
  REVOKE: 'REVOKE_STAFF_ACCESS',
} as const;

export const ADMIN_ACCESS_COMMANDS = {
  GRANT: 'GRANT_ADMIN_ACCESS',
  REVOKE: 'REVOKE_ADMIN_ACCESS',
} as const;

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
  readonly id: string;
  readonly role: AuthorityLabel | null;
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type IndependentAuthorityUserRecord = AdminAccessUserRecord & {
  readonly selectedMemberKind: MemberKind | null;
};

export const AUTHORITY_TARGETS = {
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

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

@Injectable()
export class UsersAuthorityRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: Pick<PrismaService, 'user'>,
  ) {}

  async findActorByGithubId(sessionGithubId: bigint) {
    return this.prisma.user.findUnique({
      where: { githubId: sessionGithubId },
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
  }
}

export interface IndependentAuthorityTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findActorByGithubId(githubId: bigint): Promise<AdminAccessActor | null>;
  lockActiveAdmins(): Promise<number>;
  findUserForUpdate(
    userId: string,
  ): Promise<IndependentAuthorityUserRecord | null>;
  updateAuthority(
    userId: string,
    transition: IndependentAuthorityTransition,
  ): Promise<void>;

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

class PrismaIndependentAuthorityRepository implements IndependentAuthorityTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

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
        selectedMemberKind: transition.selectedMemberKind,
        hasStaffAccess: transition.hasStaffAccess,
        hasAdminAccess: transition.hasAdminAccess,
      },
    });
  }

  insertRevokedRequest(
    input: AdminAccessRevokedRequestInsert,
  ): Promise<AdminAccessInsertedRequest> {
    return insertRevokedStaffAccessRequest(this.transaction, input);
  }
}

function toIndependentAuthorityUserRecord(
  user: Prisma.UserGetPayload<{ select: typeof ADMIN_ACCESS_USER_SELECT }>,
): IndependentAuthorityUserRecord {
  return {
    ...AdminAccessUserProjectionRepository.toAdminAccessUserRecord(user),
    selectedMemberKind: user.selectedMemberKind,
  };
}

@Injectable()
export class IndependentAuthorityRepository implements IndependentAuthorityRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: IndependentAuthorityTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaIndependentAuthorityRepository(transaction)),
    );
  }
}
