import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isCompleteProfileFields } from '../../users/user-profile-policy';
import { AuthConfig } from '../auth.config';
import type { InitialAccountSeed } from '../domain/initial-roles';
import type {
  AuthLoginResult,
  AuthUser,
  GithubProfile,
} from '../domain/auth-user';

const AUTH_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  avatarUrl: true,
  notificationEmail: true,
  accountStatus: true,
  sessionVersion: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,

  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
    },
  },
} as const satisfies Prisma.UserSelect;

type AuthUserRow = Prisma.UserGetPayload<{
  select: typeof AUTH_USER_SELECT;
}>;

export class StaffAccessRequestSeedConflictError extends Error {
  constructor() {
    super('초기 역할 시드가 전이하려던 신청이 이미 결정되었습니다.');
    this.name = 'StaffAccessRequestSeedConflictError';
  }
}

export interface AuthTransactionStore {
  upsertUser(profile: GithubProfile): Promise<AuthLoginResult>;
}

class PrismaAuthTransactionStore implements AuthTransactionStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly config: AuthConfig,
    private readonly logger: Logger,
  ) {}

  async upsertUser(profile: GithubProfile): Promise<AuthLoginResult> {
    const initialRole = this.config.resolveInitialRole(profile.githubId);
    const created = await this.transaction.user.createMany({
      data: {
        githubId: profile.githubId,
        nickname: profile.login,
        avatarUrl: profile.avatarUrl,
        ...(profile.email !== null ? { notificationEmail: profile.email } : {}),
      },
      skipDuplicates: true,
    });
    let user: AuthUserRow;
    if (created.count === 1) {
      user = await this.transaction.user.findUniqueOrThrow({
        where: { githubId: profile.githubId },
        select: AUTH_USER_SELECT,
      });
    } else {
      const current = await this.transaction.user.findUniqueOrThrow({
        where: { githubId: profile.githubId },
        select: AUTH_USER_SELECT,
      });
      user = await this.transaction.user.update({
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
    }

    if (
      initialRole &&
      user.accountStatus === AccountStatus.ACTIVE &&
      !hasSeededAuthority(user)
    ) {
      const promoted = await this.transaction.user.updateMany({
        where: {
          id: user.id,
          accountStatus: AccountStatus.ACTIVE,
          hasStaffAccess: false,
          hasAdminAccess: false,
          profile: { is: null },

          staffAccessRequests: {
            none: { status: StaffAccessRequestStatus.REVOKED },
          },
        },
        data: {
          selectedMemberKind: initialRole.memberKind,
          hasStaffAccess: initialRole.hasStaffAccess,
          hasAdminAccess: initialRole.hasAdminAccess,
        },
      });
      if (promoted.count === 1) {
        if (initialRole.hasStaffAccess) {
          const pendingRequest =
            await this.transaction.staffAccessRequest.findFirst({
              where: {
                userId: user.id,
                status: StaffAccessRequestStatus.PENDING,
              },
            });
          if (pendingRequest) {
            const transitioned =
              await this.transaction.staffAccessRequest.updateMany({
                where: {
                  id: pendingRequest.id,
                  status: StaffAccessRequestStatus.PENDING,
                },
                data: {
                  status: StaffAccessRequestStatus.APPROVED,
                  decidedById: null,
                  decidedAt: new Date(),
                  rejectionReason: null,
                },
              });
            if (transitioned.count !== 1) {
              throw new StaffAccessRequestSeedConflictError();
            }
          } else {
            await this.transaction.staffAccessRequest.create({
              data: {
                userId: user.id,
                status: StaffAccessRequestStatus.APPROVED,
                decidedById: null,
                decidedAt: new Date(),
              },
            });
          }
          this.logger.log(
            `초기 시드 적용: ${describeSeed(initialRole)}, pendingStaffAccessRequest=${pendingRequest !== null}`,
          );
        } else {
          this.logger.log(`초기 시드 적용: ${describeSeed(initialRole)}`);
        }
        user = await this.transaction.user.findUniqueOrThrow({
          where: { id: user.id },
          select: AUTH_USER_SELECT,
        });
      } else {
        const revokedRequest =
          await this.transaction.staffAccessRequest.findFirst({
            where: {
              userId: user.id,
              status: StaffAccessRequestStatus.REVOKED,
            },
            select: { id: true },
          });
        if (revokedRequest) {
          this.logger.debug(
            `초기 시드 미적용: ${describeSeed(initialRole)} — 회수된 계정이다.`,
          );
        } else {
          this.logger.warn(
            `초기 시드 미적용: ${describeSeed(initialRole)} — 다른 트랜잭션이 먼저 결정했다.`,
          );
        }
      }
    }
    return { user: toDomain(user), isNew: created.count === 1 };
  }
}

@Injectable()
export class AuthRepository {
  private readonly logger = new Logger(AuthRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AuthConfig,
  ) {}

  withTransaction<T>(
    operation: (store: AuthTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(
        new PrismaAuthTransactionStore(transaction, this.config, this.logger),
      ),
    );
  }

  async findByGithubId(githubId: bigint): Promise<AuthUser | null> {
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
}

function toDomain(user: AuthUserRow): AuthUser {
  const profile = user.profile;
  const memberKind = profile?.memberKind ?? null;
  return {
    id: user.id,
    githubId: user.githubId,
    nickname: user.nickname,
    name: profile?.name ?? null,
    avatarUrl: user.avatarUrl,
    accountStatus: user.accountStatus,
    sessionVersion: user.sessionVersion,
    memberKind,
    hasStaffAccess: user.hasStaffAccess,
    hasAdminAccess: user.hasAdminAccess,
    isProfileComplete: isCompleteProfileFields(
      {
        name: profile?.name ?? null,
        studentId: profile?.studentId ?? null,
        department: profile?.department ?? null,
      },
      memberKind ?? user.selectedMemberKind,
    ),
  };
}

function hasSeededAuthority(user: AuthUserRow): boolean {
  return user.profile !== null || user.hasStaffAccess || user.hasAdminAccess;
}

function describeSeed(seed: InitialAccountSeed): string {
  return `memberKind=${seed.memberKind ?? 'none'} staff=${seed.hasStaffAccess} admin=${seed.hasAdminAccess}`;
}
