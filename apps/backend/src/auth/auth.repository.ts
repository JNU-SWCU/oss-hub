import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, StaffAccessRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isCompleteProfileFields } from '../users/user-profile-policy';
import { AuthConfig } from './auth.config';
import type { InitialAccountSeed } from './initial-roles';
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
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  // 이름만이 아니라 학번·소속까지 읽는다 — 세션이 `isProfileComplete`를 함께 실어야
  // 화면 게이트가 "고르긴 골랐는데 프로필이 비어 있는" 사용자를 프로필 단계로
  // 되돌릴 수 있다. 온보딩 순서를 유형 → 프로필로 바꾸면서 생긴 상태다.
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

/**
 * 초기 시드가 PENDING 신청을 APPROVED로 전이하려는 순간
 * 관리자가 같은 신청을 먼저 결정한 경우다. 트랜잭션을 되돌려
 * 시드가 매긴 접근 권한까지 함께 취소하기 위해 던진다.
 */
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
      !hasSeededAuthority(user)
    ) {
      const promoted = await this.transaction.user.updateMany({
        where: {
          id: user.id,
          accountStatus: AccountStatus.ACTIVE,
          hasStaffAccess: false,
          hasAdminAccess: false,
          profile: { is: null },
          // 관리자가 한 번이라도 회수한 계정에는 시드를 적용하지 않는다.
          // 회수는 `hasStaffAccess`를 끄므로 회수된 사람은 위 조건을 그대로
          // 만족할 수 있다 — 이 조건이 없으면 그가 다음에 로그인하는
          // 순간 환경 변수가 권한을 되살리고, STAFF면 `decidedById: null`인
          // APPROVED 신청까지 새로 만들어 관리자의 결정이 조용히 뒤집힌다.
          //
          // "가장 최근 요청이 REVOKED인가"가 아니라 "회수 이력이 있는가"로 본다.
          // 회수 뒤 다시 승인받은 사람은 `hasStaffAccess`가 켜져 있어 애초에 이 블록에
          // 들어오지 않으므로 더 느슨한 조건에서 얻을 것이 없고, 반대로 회수
          // 이후에 새 신청 행이 생기는 경로가 나중에 열리면 "최신" 판정은
          // 그 행에 가려 시드를 다시 허용해 버린다. 회수 구현이 기존 행을
          // 갱신하는지 새 행을 만드는지에도 좌우되지 않는 조건을 택했다.
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
          const pendingRequest = await this.transaction.staffAccessRequest.findFirst({
            where: { userId: user.id, status: StaffAccessRequestStatus.PENDING },
          });
          if (pendingRequest) {
            // 조회 이후 관리자가 같은 신청을 결정했을 수 있다. status를 CAS guard로 걸어
            // 진 쪽이 관리자의 결정을 decidedById=null로 덮어쓰지 못하게 한다.
            const transitioned = await this.transaction.staffAccessRequest.updateMany({
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
              // 트랜잭션 전체를 되돌려 시드가 매긴 User.role까지 함께 취소한다.
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
        // 조건부 갱신이 한 행도 잡지 못한 경우다. 원인은 두 가지인데 성격이
        // 정반대라 같은 레벨로 묶으면 안 된다.
        //
        // 회수된 계정은 `role`이 영구히 null이라 로그인할 때마다 이 분기에
        // 들어온다 — 설계대로 막히는 정상 상태다. 그것을 warn으로 남기면 로그가
        // 그 한 사람으로 채워져 정작 드물어야 하는 CAS 경합 신호가 묻힌다.
        // 그래서 여기서만(드물게 도는 경로다) 이유를 실제로 확인해 레벨을 가른다.
        const revokedRequest = await this.transaction.staffAccessRequest.findFirst({
          where: { userId: user.id, status: StaffAccessRequestStatus.REVOKED },
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

/**
 * 이 계정에 이미 확정된 사실이 하나라도 있는가.
 *
 * 시드는 **아무것도 정해지지 않은** 계정에만 적용한다. 프로필 행이 있으면 회원
 * 정체성이 확정된 것이고, 접근 권한이 켜져 있으면 관리자가 이미 결정한 것이다 —
 * 둘 중 하나라도 있으면 환경 변수가 그 결정을 덮어써서는 안 된다.
 */
function hasSeededAuthority(user: AuthUserRow): boolean {
  return (
    user.profile !== null || user.hasStaffAccess || user.hasAdminAccess
  );
}

function describeSeed(seed: InitialAccountSeed): string {
  return `memberKind=${seed.memberKind ?? 'none'} staff=${seed.hasStaffAccess} admin=${seed.hasAdminAccess}`;
}
