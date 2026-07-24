import { Injectable } from '@nestjs/common';
import type { Prisma, Role, User as PrismaUser } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminUser, AdminUserListQuery } from './domain/admin-user';

export interface AdminUserRecord extends Omit<AdminUser, 'isSelf'> {
  readonly githubId: bigint;
}

export interface AdminUsersTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findUserByGithubId(githubId: bigint): Promise<AdminUserRecord | null>;
  findUserById(id: string): Promise<AdminUserRecord | null>;
  updateRole(id: string, role: Role): Promise<AdminUserRecord | null>;
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
    });
    return user ? toAdminUser(user) : null;
  }

  async findUserById(id: string): Promise<AdminUserRecord | null> {
    const user = await this.transaction.user.findUnique({ where: { id } });
    return user ? toAdminUser(user) : null;
  }

  async updateRole(id: string, role: Role): Promise<AdminUserRecord | null> {
    const result = await this.transaction.user.updateMany({
      where: { id },
      data: { role },
    });
    return result.count === 1 ? this.findUserById(id) : null;
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
    const user = await this.prisma.user.findUnique({ where: { githubId } });
    return user ? toAdminUser(user) : null;
  }

  async list(query: AdminUserListQuery): Promise<readonly AdminUserRecord[]> {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      OR: query.query
        ? [
            { name: { contains: query.query, mode: 'insensitive' } },
            { login: { contains: query.query, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: [{ name: 'asc' }, { login: 'asc' }, { id: 'asc' }],
    });
    return users.map(toAdminUser);
  }
}

function toAdminUser(
  user: Pick<
    PrismaUser,
    'id' | 'githubId' | 'login' | 'name' | 'role' | 'accountStatus'
  >,
): AdminUserRecord {
  return {
    id: user.id,
    githubId: user.githubId,
    githubLogin: user.login,
    name: user.name,
    role: user.role,
    accountStatus: user.accountStatus,
  };
}
