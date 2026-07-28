import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { Prisma, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthConfig } from './auth.config';
import type {
  AuthLoginResult,
  AuthUser,
  GithubProfile,
} from './domain/auth-user';

/**
 * 초기 역할 시드가 PENDING 신청을 APPROVED로 전이하려는 순간
 * 관리자가 같은 신청을 먼저 결정한 경우다. 트랜잭션을 되돌려
 * 시드가 매긴 User.role까지 함께 취소하기 위해 던진다.
 */
export class RoleRequestSeedConflictError extends Error {
  constructor() {
    super('초기 역할 시드가 전이하려던 신청이 이미 결정되었습니다.');
    this.name = 'RoleRequestSeedConflictError';
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

  /**
   * 기존 사용자는 nickname·avatarUrl만 갱신한다 — 온보딩 name과 권한 상태는 로그인마다 유지된다.
   *
   * name은 update 절에서 제외한다. 온보딩 프로필(#220)에서 사용자가 직접 확정한 값을
   * GitHub 프로필 재로그인이 덮어쓰면 완료된 온보딩 상태가 되돌아가기 때문이다.
   *
   * notificationEmail은 생성 시 profile.email이 있으면 시드하고, 기존 사용자는
   * 현재 값이 null일 때만 채운다(이미 설정된 값은 덮어쓰지 않는다). notifyEnabled는 건드리지 않는다.
   */
  async upsertUser(profile: GithubProfile): Promise<AuthLoginResult> {
    const initialRole = this.config.resolveInitialRole(profile.githubId);
    const created = await this.transaction.user.createMany({
      data: {
        githubId: profile.githubId,
        nickname: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        ...(profile.email !== null ? { notificationEmail: profile.email } : {}),
      },
      skipDuplicates: true,
    });
    let user: PrismaUser;
    if (created.count === 1) {
      user = await this.transaction.user.findUniqueOrThrow({
        where: { githubId: profile.githubId },
      });
    } else {
      const current = await this.transaction.user.findUniqueOrThrow({
        where: { githubId: profile.githubId },
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
      });
    }

    if (
      initialRole &&
      user.accountStatus === AccountStatus.ACTIVE &&
      user.role === null
    ) {
      const promoted = await this.transaction.user.updateMany({
        where: {
          id: user.id,
          accountStatus: AccountStatus.ACTIVE,
          role: null,
        },
        data: { role: initialRole },
      });
      if (promoted.count === 1) {
        if (initialRole === Role.STAFF) {
          const pendingRequest = await this.transaction.roleRequest.findFirst({
            where: { userId: user.id, status: RoleRequestStatus.PENDING },
          });
          if (pendingRequest) {
            // 조회 이후 관리자가 같은 신청을 결정했을 수 있다. status를 CAS guard로 걸어
            // 진 쪽이 관리자의 결정을 decidedById=null로 덮어쓰지 못하게 한다.
            const transitioned = await this.transaction.roleRequest.updateMany({
              where: {
                id: pendingRequest.id,
                status: RoleRequestStatus.PENDING,
              },
              data: {
                status: RoleRequestStatus.APPROVED,
                decidedById: null,
                decidedAt: new Date(),
                rejectionReason: null,
              },
            });
            if (transitioned.count !== 1) {
              // 트랜잭션 전체를 되돌려 시드가 매긴 User.role까지 함께 취소한다.
              throw new RoleRequestSeedConflictError();
            }
          } else {
            await this.transaction.roleRequest.create({
              data: {
                userId: user.id,
                status: RoleRequestStatus.APPROVED,
                decidedById: null,
                decidedAt: new Date(),
              },
            });
          }
          this.logger.log(
            `초기 역할 시드 적용: role=${initialRole}, pendingRoleRequest=${pendingRequest !== null}`,
          );
        } else {
          this.logger.log(`초기 역할 시드 적용: role=${initialRole}`);
        }
        user = await this.transaction.user.findUniqueOrThrow({
          where: { id: user.id },
        });
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
    const user = await this.prisma.user.findUnique({ where: { githubId } });
    return user ? toDomain(user) : null;
  }
}

function toDomain(user: PrismaUser): AuthUser {
  return {
    id: user.id,
    githubId: user.githubId,
    nickname: user.nickname,
    name: user.name,
    avatarUrl: user.avatarUrl,
    accountStatus: user.accountStatus,
    role: user.role,
  };
}
