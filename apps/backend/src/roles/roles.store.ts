import { Injectable } from '@nestjs/common';
import { Prisma, RoleRequestStatus } from '@prisma/client';
import type {
  Prisma as PrismaTypes,
  Role,
  RoleRequest as PrismaRoleRequest,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
} from '../profiles/profile-compatibility';
import type { RoleRequestRecord, RoleUser } from './domain/role-onboarding';
import { confirmSelectedRole } from './role-confirmation';
import type {
  RoleConfirmation,
  RoleConfirmationTarget,
} from './role-confirmation';

/**
 * 역할 판단에 필요한 사용자 필드.
 *
 * 프로필 값까지 함께 읽는다 — 역할 선택이 "여기서 확정할지"를 판단하려면 지금 프로필이
 * 완료돼 있는지 알아야 한다(`domain/role-onboarding.ts`의 `RoleUser.profile`).
 * `COMPATIBLE_PROFILE_SELECT`를 쓰는 이유는 프로필의 정식 자리가 `UserProfile` 행이고
 * 그 행이 없는 계정은 구버전 `User` 컬럼으로 떨어지기 때문이다.
 */
const ROLE_USER_SELECT = {
  id: true,
  role: true,
  selectedRole: true,
  accountStatus: true,
  ...COMPATIBLE_PROFILE_SELECT,
} as const satisfies PrismaTypes.UserSelect;

type RoleUserRow = PrismaTypes.UserGetPayload<{
  select: typeof ROLE_USER_SELECT;
}>;

export interface RolesTransactionStore {
  findUserByGithubId(githubId: bigint): Promise<RoleUser | null>;
  /** 고른 역할을 기록한다 — 확정이 아니다(#569). 확정은 `role-confirmation.ts`가 한다. */
  updateSelectedRole(userId: string, role: Role): Promise<RoleUser>;
  findPendingRequest(userId: string): Promise<RoleRequestRecord | null>;
  findLatestRequest(userId: string): Promise<RoleRequestRecord | null>;
  createPendingRequest(userId: string): Promise<RoleRequestRecord>;
  /**
   * 고른 역할을 확정한다 — 규칙은 `role-confirmation.ts`가 하나로 들고 있다.
   *
   * 트랜잭션 클라이언트를 그대로 내놓지 않고 이 문 하나로 감싸는 이유는, 내놓는 순간
   * 호출부가 확정 규칙을 우회해 `role`을 직접 쓰는 길이 열리기 때문이다.
   */
  confirmSelectedRole(
    target: RoleConfirmationTarget,
  ): Promise<RoleConfirmation>;
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

  confirmSelectedRole(
    target: RoleConfirmationTarget,
  ): Promise<RoleConfirmation> {
    return confirmSelectedRole(this.transaction, target);
  }

  async findUserByGithubId(githubId: bigint): Promise<RoleUser | null> {
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "githubId" = ${githubId} FOR UPDATE`,
    );
    const user = await this.transaction.user.findUnique({
      where: { githubId },
      select: ROLE_USER_SELECT,
    });
    return user ? toRoleUser(user) : null;
  }

  async updateSelectedRole(userId: string, role: Role): Promise<RoleUser> {
    const user = await this.transaction.user.update({
      where: { id: userId },
      data: { selectedRole: role },
      select: ROLE_USER_SELECT,
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
export class RolesStore implements RolesRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (store: RolesTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaRolesTransactionStore(transaction)),
    );
  }

  async findUserByGithubId(githubId: bigint): Promise<RoleUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: ROLE_USER_SELECT,
    });
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

function toRoleUser(user: RoleUserRow): RoleUser {
  return {
    id: user.id,
    role: user.role,
    selectedRole: user.selectedRole,
    accountStatus: user.accountStatus,
    profile: resolveCompatibleProfile(user),
  };
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
