import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, Role, RoleRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
} from '../profiles/profile-compatibility';
import { isCompleteProfileFields } from '../users/user-profile-policy';
import { AuthConfig } from './auth.config';
import type {
  AuthLoginResult,
  AuthUser,
  GithubProfile,
} from './domain/auth-user';

const AUTH_USER_SELECT = {
  id: true,
  githubId: true,
  nickname: true,
  avatarUrl: true,
  notificationEmail: true,
  accountStatus: true,
  role: true,
  // 이름만이 아니라 학번·학과까지 읽는다 — 세션이 `isProfileComplete`를 함께 실어야
  // 화면 게이트가 "역할은 정해졌는데 프로필이 비어 있는" 사용자를 프로필 단계로
  // 되돌릴 수 있다. 온보딩 순서를 역할 → 프로필로 바꾸면서 생긴 상태다.
  ...COMPATIBLE_PROFILE_SELECT,
} as const satisfies Prisma.UserSelect;

type AuthUserRow = Prisma.UserGetPayload<{
  select: typeof AUTH_USER_SELECT;
}>;

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
   * 신규·기존 사용자 모두 GitHub에서 profile 소유 필드를 저장하지 않는다.
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
          select: AUTH_USER_SELECT,
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
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: AUTH_USER_SELECT,
    });
    return user ? toDomain(user) : null;
  }
}

function toDomain(user: AuthUserRow): AuthUser {
  const profile = resolveCompatibleProfile(user);
  return {
    id: user.id,
    githubId: user.githubId,
    nickname: user.nickname,
    name: profile.name,
    avatarUrl: user.avatarUrl,
    accountStatus: user.accountStatus,
    role: user.role,
    // 역할이 아직 없는 사용자는 이 값을 쓰지 않는다 — 그쪽은 온보딩 게이트가 프로필을
    // 직접 조회해 판단하고, 승인 대기 중인 교직원처럼 역할이 null인 상태까지 본다.
    // 여기서 필요한 것은 "역할이 정해진 사용자의 프로필이 완료됐는가" 하나다.
    isProfileComplete: isCompleteProfileFields(profile, user.role),
  };
}
