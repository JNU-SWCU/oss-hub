import { Injectable } from '@nestjs/common';
import type { Prisma, Role, RoleRequestStatus } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';
import {
  compatibleProfileNameWhere,
  COMPATIBLE_PROFILE_NAME_SELECT,
  resolveCompatibleProfileName,
} from '../profiles/profile-compatibility';
import type { AdminUser, AdminUserListQuery } from './domain/admin-user';

const ADMIN_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  role: true,
  accountStatus: true,
  ...COMPATIBLE_PROFILE_NAME_SELECT,
} as const satisfies Prisma.UserSelect;

export interface AdminUserRecord extends Omit<AdminUser, 'isSelf'> {
  readonly githubId: bigint;
}
export interface AdminRoleRequestRecord {
  readonly id: string;
  readonly status: RoleRequestStatus;
}

export interface AdminRoleRequestTransition {
  readonly requestId: string;
  readonly expectedStatus: RoleRequestStatus;
  readonly nextStatus: RoleRequestStatus;
  readonly decidedById: string;
  readonly decidedAt: Date;
  readonly rejectionReason: string | null;
}

export interface AdminUsersTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findUserByGithubId(githubId: bigint): Promise<AdminUserRecord | null>;
  findUserById(id: string): Promise<AdminUserRecord | null>;
  updateRole(id: string, role: Role): Promise<AdminUserRecord | null>;
  findLatestRoleRequest(userId: string): Promise<AdminRoleRequestRecord | null>;
  transitionRoleRequest(input: AdminRoleRequestTransition): Promise<boolean>;
}

export interface AdminUsersRepositoryPort {
  withTransaction<T>(
    operation: (store: AdminUsersTransactionStore) => Promise<T>,
  ): Promise<T>;
  findUserByGithubId(githubId: bigint): Promise<AdminUserRecord | null>;
  list(query: AdminUserListQuery): Promise<readonly AdminUserRecord[]>;
}

class PrismaAdminUsersTransactionStore implements AdminUsersTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async findUserByGithubId(githubId: bigint): Promise<AdminUserRecord | null> {
    const user = await this.transaction.user.findUnique({
      where: { githubId },
      select: ADMIN_USER_SELECT,
    });
    return user ? toAdminUser(user) : null;
  }

  async findUserById(id: string): Promise<AdminUserRecord | null> {
    const user = await this.transaction.user.findUnique({
      where: { id },
      select: ADMIN_USER_SELECT,
    });
    return user ? toAdminUser(user) : null;
  }

  async updateRole(id: string, role: Role): Promise<AdminUserRecord | null> {
    const result = await this.transaction.user.updateMany({
      where: { id },
      data: { role },
    });
    return result.count === 1 ? this.findUserById(id) : null;
  }
  async findLatestRoleRequest(
    userId: string,
  ): Promise<AdminRoleRequestRecord | null> {
    return this.transaction.roleRequest.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    });
  }

  async transitionRoleRequest(
    input: AdminRoleRequestTransition,
  ): Promise<boolean> {
    const result = await this.transaction.roleRequest.updateMany({
      where: { id: input.requestId, status: input.expectedStatus },
      data: {
        status: input.nextStatus,
        rejectionReason: input.rejectionReason,
        decidedById: input.decidedById,
        decidedAt: input.decidedAt,
      },
    });
    return result.count === 1;
  }
}

@Injectable()
export class AdminUsersRepository implements AdminUsersRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: AdminUsersTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaAdminUsersTransactionStore(transaction)),
    );
  }

  async findUserByGithubId(githubId: bigint): Promise<AdminUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: ADMIN_USER_SELECT,
    });
    return user ? toAdminUser(user) : null;
  }

  async list(query: AdminUserListQuery): Promise<readonly AdminUserRecord[]> {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      OR: query.query
        ? [
            compatibleProfileNameWhere(query.query),
            { nickname: { contains: query.query, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const users = await this.prisma.user.findMany({
      where,
      select: ADMIN_USER_SELECT,
    });
    return users.map(toAdminUser).sort((left, right) => {
      const nameOrder =
        left.name === null
          ? right.name === null
            ? 0
            : 1
          : right.name === null
            ? -1
            : left.name.localeCompare(right.name, 'ko');
      if (nameOrder !== 0) {
        return nameOrder;
      }
      const loginOrder = left.githubLogin.localeCompare(
        right.githubLogin,
        'en',
      );
      return loginOrder !== 0 ? loginOrder : left.id.localeCompare(right.id);
    });
  }
}

function toAdminUser(
  user: Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>,
): AdminUserRecord {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.nickname,
    name: resolveCompatibleProfileName(user),
    role: user.role,
    accountStatus: user.accountStatus,
  };
}
