import { Injectable } from '@nestjs/common';
import { RoleRequestStatus } from '@prisma/client';
import type {
  Prisma,
  Role,
  RoleRequest as PrismaRoleRequest,
  User as PrismaUser,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RoleRequestRecord, RoleUser } from './domain/role-onboarding';

export interface RolesTransactionStore {
  findUserByGithubId(githubId: bigint): Promise<RoleUser | null>;
  updateUserRole(userId: string, role: Role): Promise<RoleUser>;
  findPendingRequest(userId: string): Promise<RoleRequestRecord | null>;
  findLatestRequest(userId: string): Promise<RoleRequestRecord | null>;
  createPendingRequest(userId: string): Promise<RoleRequestRecord>;
}

export interface RolesRepositoryPort {
  withTransaction<T>(
    operation: (store: RolesTransactionStore) => Promise<T>,
  ): Promise<T>;
  findUserByGithubId(githubId: bigint): Promise<RoleUser | null>;
  findLatestRequest(userId: string): Promise<RoleRequestRecord | null>;
}

class PrismaRolesTransactionStore implements RolesTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async findUserByGithubId(githubId: bigint): Promise<RoleUser | null> {
    const user = await this.transaction.user.findUnique({
      where: { githubId },
    });
    return user ? toRoleUser(user) : null;
  }

  async updateUserRole(userId: string, role: Role): Promise<RoleUser> {
    const user = await this.transaction.user.update({
      where: { id: userId },
      data: { role },
    });
    return toRoleUser(user);
  }

  async findPendingRequest(userId: string): Promise<RoleRequestRecord | null> {
    const request = await this.transaction.roleRequest.findFirst({
      where: { userId, status: RoleRequestStatus.PENDING },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return request ? toRoleRequest(request) : null;
  }

  async findLatestRequest(userId: string): Promise<RoleRequestRecord | null> {
    const request = await this.transaction.roleRequest.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return request ? toRoleRequest(request) : null;
  }

  async createPendingRequest(userId: string): Promise<RoleRequestRecord> {
    const request = await this.transaction.roleRequest.create({
      data: { userId },
    });
    return toRoleRequest(request);
  }
}

@Injectable()
export class RolesRepository implements RolesRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: RolesTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaRolesTransactionStore(transaction)),
    );
  }

  async findUserByGithubId(githubId: bigint): Promise<RoleUser | null> {
    const user = await this.prisma.user.findUnique({ where: { githubId } });
    return user ? toRoleUser(user) : null;
  }

  async findLatestRequest(userId: string): Promise<RoleRequestRecord | null> {
    const request = await this.prisma.roleRequest.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return request ? toRoleRequest(request) : null;
  }
}

function toRoleUser(user: PrismaUser): RoleUser {
  return { id: user.id, role: user.role };
}

function toRoleRequest(request: PrismaRoleRequest): RoleRequestRecord {
  return {
    id: request.id,
    userId: request.userId,
    status: request.status,
    rejectionReason: request.rejectionReason,
    decidedAt: request.decidedAt,
    createdAt: request.createdAt,
  };
}
