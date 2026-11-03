import type { ApprovalStatus } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import {
  type LoginHistory as PrismaLoginHistory,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../platform/prisma.service';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { LOGIN_HISTORY_PROVIDER } from '../platform/auth.config';
import type {
  LoginHistory,
  LoginHistoryEvent,
  LoginHistoryPage,
  AuthUser,
  GithubProfile,
} from './http-auth.types';
import type { MemberKind } from '../users/user-contract.config';

@Injectable()
export class LoginHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, event: LoginHistoryEvent): Promise<void> {
    await this.prisma.loginHistory.create({
      data: {
        userId,
        event,
        provider: LOGIN_HISTORY_PROVIDER,
        success: true,
      },
    });
  }

  async findPage(
    userId: string,
    page: number,
    size: number,
  ): Promise<LoginHistoryPage> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loginHistory.findMany({
        where: { userId },
        orderBy: { loginAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.loginHistory.count({ where: { userId } }),
    ]);
    return {
      items: rows.map((row) => this.toDomain(row)),
      page,
      size,
      total,
    };
  }

  private toDomain(row: PrismaLoginHistory): LoginHistory {
    return {
      id: row.id,
      event: row.event,
      provider: LOGIN_HISTORY_PROVIDER,
      success: row.success,
      loginAt: row.loginAt,
    };
  }
}

const AUTH_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  avatarUrl: true,
  notificationEmail: true,
  accountStatus: true,
  sessionVersion: true,
  ...USER_AUTHORITY_SELECT,
} as const satisfies Prisma.UserSelect;
type AuthUserRow = Prisma.UserGetPayload<{ select: typeof AUTH_USER_SELECT }>;

export interface AuthTransactionStore {
  upsertUser(profile: GithubProfile): Promise<AuthLoginRow>;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: AuthTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation({
        upsertUser: (profile) => this.upsertUserIn(transaction, profile),
      }),
    );
  }

  async findByGithubId(githubId: bigint): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: AUTH_USER_SELECT,
    });
    return user ? toDomain(user) : null;
  }

  async incrementSessionVersion(githubId: bigint): Promise<void> {
    await this.prisma.user.update({
      where: { githubId },
      data: { sessionVersion: { increment: 1 } },
      select: { id: true },
    });
  }

  private async upsertUserIn(
    transaction: Prisma.TransactionClient,
    profile: GithubProfile,
  ): Promise<AuthLoginRow> {
    const created = await transaction.user.createMany({
      data: {
        githubId: profile.githubId,
        nickname: profile.login,
        avatarUrl: profile.avatarUrl,
        ...(profile.email === null ? {} : { notificationEmail: profile.email }),
      },
      skipDuplicates: true,
    });
    const current = await transaction.user.findUniqueOrThrow({
      where: { githubId: profile.githubId },
      select: AUTH_USER_SELECT,
    });
    if (created.count === 1) {
      await transaction.userHistory.create({
        data: {
          id: 'user:' + randomUUID(),
          userId: current.id,
          actorId: current.id,
          event: 'SIGNED_UP',
          source: 'APPLICATION',
          data: { schemaVersion: 1, recordKind: 'SIGNUP' },
        },
      });
      return { user: toDomain(current), isNew: true };
    }
    const user = await transaction.user.update({
      where: { githubId: profile.githubId },
      data: {
        nickname: profile.login,
        avatarUrl: profile.avatarUrl,
        ...(profile.email !== null && current.notificationEmail === null
          ? { notificationEmail: profile.email }
          : {}),
      },
      select: AUTH_USER_SELECT,
    });
    return { user: toDomain(user), isNew: false };
  }
}

export interface AuthLoginRow {
  readonly user: AuthUserRecord;
  readonly isNew: boolean;
}
export type AuthUserRecord = Omit<
  AuthUser,
  'isProfileComplete' | 'hasStaffAccess'
> & {
  readonly selectedMemberKind: MemberKind | null;
  readonly studentId: string | null;
  readonly department: string | null;
  readonly profileCreatedAt: Date | null;
  readonly approvalStatus: ApprovalStatus;
};
function toDomain(user: AuthUserRow): AuthUserRecord {
  return {
    id: user.id,
    githubId: user.githubId,
    nickname: user.nickname,
    name: user.name,
    avatarUrl: user.avatarUrl,
    accountStatus: user.accountStatus,
    sessionVersion: user.sessionVersion,
    memberKind: user.type === 'UNSELECTED' ? null : user.type,
    selectedMemberKind: user.type === 'UNSELECTED' ? null : user.type,
    approvalStatus: user.approvalStatus,
    hasAdminAccess: user.admin !== null,
    studentId: user.studentId,
    department: user.department,
    profileCreatedAt: user.profileCreatedAt,
  };
}
