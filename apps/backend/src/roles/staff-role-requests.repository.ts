import { Injectable } from '@nestjs/common';
import { RoleRequestStatus } from '@prisma/client';
import type { Prisma, User as PrismaUser } from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import { PrismaService } from '../prisma/prisma.service';
import type { UserProfileRecord } from '../users/user-profile-policy';
import type { RoleUser } from './domain/role-onboarding';
import type {
  StaffRoleRequestListQuery,
  StaffRoleReactivationApproval,
  StaffRoleRequestRecord,
  StaffRoleRequestTransition,
  StaffUserAccountStatusTransition,
  StaffUserRoleTransition,
} from './domain/staff-role-request';

const staffRoleRequestInclude = {
  user: { select: { nickname: true, role: true, accountStatus: true } },
  decidedBy: { select: { nickname: true } },
} satisfies Prisma.RoleRequestInclude;

type PrismaStaffRoleRequest = Prisma.RoleRequestGetPayload<{
  include: typeof staffRoleRequestInclude;
}>;

export interface StaffRoleRequestsTransactionStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findUserByGithubId(githubId: bigint): Promise<RoleUser | null>;
  findUserProfileById(userId: string): Promise<UserProfileRecord | null>;
  findRequestById(id: string): Promise<StaffRoleRequestRecord | null>;
  transitionRequest(input: StaffRoleRequestTransition): Promise<boolean>;
  transitionUserRole(input: StaffUserRoleTransition): Promise<boolean>;
  transitionUserAccountStatus(
    input: StaffUserAccountStatusTransition,
  ): Promise<boolean>;
  createApprovedReactivation(
    input: StaffRoleReactivationApproval,
  ): Promise<StaffRoleRequestRecord>;
}

export interface StaffRoleRequestsRepositoryPort {
  withTransaction<T>(
    operation: (store: StaffRoleRequestsTransactionStore) => Promise<T>,
  ): Promise<T>;
  findUserByGithubId(githubId: bigint): Promise<RoleUser | null>;
  list(query: StaffRoleRequestListQuery): Promise<{
    readonly items: readonly StaffRoleRequestRecord[];
    readonly total: number;
  }>;
}

class PrismaStaffRoleRequestsTransactionStore implements StaffRoleRequestsTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.transaction;
  }

  async findUserByGithubId(githubId: bigint): Promise<RoleUser | null> {
    const user = await this.transaction.user.findUnique({
      where: { githubId },
    });
    return user ? toRoleUser(user) : null;
  }

  findUserProfileById(userId: string): Promise<UserProfileRecord | null> {
    return this.transaction.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        studentId: true,
        department: true,
      },
    });
  }

  async findRequestById(id: string): Promise<StaffRoleRequestRecord | null> {
    const request = await this.transaction.roleRequest.findUnique({
      where: { id },
      include: staffRoleRequestInclude,
    });
    return request ? toStaffRoleRequest(request) : null;
  }

  async transitionRequest(input: StaffRoleRequestTransition): Promise<boolean> {
    const result = await this.transaction.roleRequest.updateMany({
      where: { id: input.requestId, status: input.expectedStatus },
      data: {
        status: input.nextStatus,
        rejectionReason: input.rejectionReason,
        decidedAt: input.decidedAt,
        decidedById: input.actorId,
      },
    });
    return result.count === 1;
  }

  async transitionUserRole(input: StaffUserRoleTransition): Promise<boolean> {
    const result = await this.transaction.user.updateMany({
      where: {
        id: input.userId,
        role: input.expectedRole,
        accountStatus: input.expectedAccountStatus,
      },
      data: { role: input.nextRole },
    });
    return result.count === 1;
  }

  async transitionUserAccountStatus(
    input: StaffUserAccountStatusTransition,
  ): Promise<boolean> {
    const result = await this.transaction.user.updateMany({
      where: {
        id: input.userId,
        role: input.expectedRole,
        accountStatus: input.expectedAccountStatus,
      },
      data: { accountStatus: input.nextAccountStatus },
    });
    return result.count === 1;
  }

  async createApprovedReactivation(
    input: StaffRoleReactivationApproval,
  ): Promise<StaffRoleRequestRecord> {
    const request = await this.transaction.roleRequest.create({
      data: {
        userId: input.userId,
        status: RoleRequestStatus.APPROVED,
        decidedById: input.actorId,
        decidedAt: input.decidedAt,
      },
      include: staffRoleRequestInclude,
    });
    return toStaffRoleRequest(request);
  }
}

@Injectable()
export class StaffRoleRequestsRepository implements StaffRoleRequestsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: StaffRoleRequestsTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaStaffRoleRequestsTransactionStore(transaction)),
    );
  }

  async findUserByGithubId(githubId: bigint): Promise<RoleUser | null> {
    const user = await this.prisma.user.findUnique({ where: { githubId } });
    return user ? toRoleUser(user) : null;
  }

  async list(query: StaffRoleRequestListQuery): Promise<{
    readonly items: readonly StaffRoleRequestRecord[];
    readonly total: number;
  }> {
    const where: Prisma.RoleRequestWhereInput = {
      status: query.status,
      user:
        query.query.length > 0
          ? { nickname: { contains: query.query, mode: 'insensitive' } }
          : undefined,
    };
    const [requests, total] = await Promise.all([
      this.prisma.roleRequest.findMany({
        where,
        include: staffRoleRequestInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.roleRequest.count({ where }),
    ]);
    return { items: requests.map(toStaffRoleRequest), total };
  }
}

function toRoleUser(user: PrismaUser): RoleUser {
  return {
    id: user.id,
    role: user.role,
    accountStatus: user.accountStatus,
  };
}

function toStaffRoleRequest(
  request: PrismaStaffRoleRequest,
): StaffRoleRequestRecord {
  return {
    id: request.id,
    userId: request.userId,
    githubLogin: request.user.nickname,
    userRole: request.user.role,
    userAccountStatus: request.user.accountStatus,
    status: request.status,
    rejectionReason: request.rejectionReason,
    decidedAt: request.decidedAt,
    decidedBy: request.decidedBy?.nickname ?? null,
    createdAt: request.createdAt,
  };
}
